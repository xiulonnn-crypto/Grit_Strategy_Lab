from __future__ import annotations

from datetime import datetime, timezone
import json
import pytest
from uuid import uuid4

from tests.api_test_support import assert_ok, create_grid_strategy, create_momentum_strategy, create_test_client


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
                    {"trade_date": "2026-01-31", "equity": 100.0, "benchmark": 100.0, "benchmark_return": 0.0, "is_oos": False},
                    {"trade_date": "2026-02-28", "equity": 103.2, "benchmark": 102.0, "benchmark_return": 0.02, "is_oos": False},
                    {"trade_date": "2026-03-31", "equity": 106.8, "benchmark": 101.0, "benchmark_return": -0.0098039216, "is_oos": True},
                ]
            ),
            "created_at": timestamp,
            "updated_at": timestamp,
            "completed_at": timestamp,
        },
    )
    return run_id


def _seed_completed_run_with_monthly_series(
    client,
    strategy_id: str,
    parameter_version_id: str,
    *,
    month_count: int = 150,
    start_year: int = 2013,
    start_month: int = 1,
    monthly_return: float = 0.012,
    benchmark_monthly_return: float = 0.006,
    annualized_return: float = 0.16,
    sharpe: float = 1.4,
    completed_at: str | None = None,
) -> str:
    run_id = f"run_{uuid4().hex[:10]}"
    timestamp = completed_at or _iso_now()
    chart_series = []
    equity = 100.0
    benchmark = 100.0
    for offset in range(month_count):
        month_index = start_month - 1 + offset
        year = start_year + month_index // 12
        month = month_index % 12 + 1
        equity *= 1.0 + (monthly_return + (0.001 if offset % 3 == 0 else -0.0005))
        benchmark *= 1.0 + benchmark_monthly_return
        chart_series.append(
            {
                "trade_date": f"{year:04d}-{month:02d}-28",
                "equity": round(equity, 6),
                "benchmark": round(benchmark, 6),
                "benchmark_return": benchmark_monthly_return,
                "is_oos": offset >= month_count - 36,
            }
        )
    start_date = f"{start_year:04d}-{start_month:02d}-01"
    end_date = chart_series[-1]["trade_date"] if chart_series else start_date
    effective_date = chart_series[0]["trade_date"] if chart_series else start_date
    oos_start_date = chart_series[max(0, month_count - 36)]["trade_date"] if chart_series else start_date
    client.app.state.service.storage.insert_json_row(
        "backtest_runs",
        {
            "id": run_id,
            "strategy_id": strategy_id,
            "status": "COMPLETED",
            "start_date": start_date,
            "end_date": end_date,
            "effective_date": effective_date,
            "oos_start_date": oos_start_date,
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
                    "total_return": equity / 100.0 - 1.0,
                    "annualized_return": annualized_return,
                    "sharpe": sharpe,
                    "max_drawdown": -0.08,
                }
            ),
            "warnings_json": json.dumps([]),
            "chart_series_json": json.dumps(chart_series),
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


def _seed_tips_curve_snapshot(client, *, snapshot_date: str, real_yield_pct: float) -> str:
    return client.app.state.service.market_data_repository.upsert_bond_fixed_income_snapshot(
        {
            "id": f"bond-fixture-tips10y-{snapshot_date}",
            "instrument_id": "TIPS_10Y",
            "symbol": "TIPS10Y",
            "name": "US TIPS Real Yield 10Y",
            "instrument_type": "tips_cmt",
            "currency": "USD",
            "snapshot_date": snapshot_date,
            "maturity_date": None,
            "coupon_rate_pct": None,
            "clean_price": 100.0,
            "net_price": 100.0,
            "dirty_price": 100.0,
            "full_price": 100.0,
            "accrued_interest": 0.0,
            "ytm_pct": real_yield_pct,
            "duration": 9.8,
            "convexity": 1.05,
            "source": "us_treasury_xml",
            "refresh_status": "READY",
            "missing_fields": [],
            "inferred_fields": {
                "clean_price": "tips_real_cmt_par_proxy",
                "net_price": "tips_real_cmt_par_proxy",
                "dirty_price": "tips_real_cmt_par_proxy",
                "full_price": "tips_real_cmt_par_proxy",
                "accrued_interest": "tips_real_cmt_proxy",
                "duration": "tips_real_cmt_duration_proxy",
                "convexity": "tips_real_cmt_convexity_proxy",
            },
            "raw": {
                "asset_type": "INDIVIDUAL_BOND",
                "audit_profile": "TIPS_10Y",
                "tenor_label": "10Y",
                "proxy_kind": "TIPS_REAL_CMT_PROXY",
                "yield_basis": "real",
                "real_yield_pct": real_yield_pct,
                "inflation_factor": 1.28,
                "breakeven_inflation_bps": 240.0,
                "tracking_status": "READY",
            },
        }
    )


def _seed_ust_cmt_curve_snapshot(client, *, snapshot_date: str, ytm_pct: float) -> str:
    return client.app.state.service.market_data_repository.upsert_bond_fixed_income_snapshot(
        {
            "id": f"bond-fixture-ust10y-cmt-{snapshot_date}",
            "instrument_id": "UST_CMT_10Y",
            "symbol": "UST10Y",
            "name": "US Treasury Constant Maturity 10Y",
            "instrument_type": "treasury_cmt",
            "currency": "USD",
            "snapshot_date": snapshot_date,
            "maturity_date": None,
            "coupon_rate_pct": None,
            "clean_price": 100.0,
            "net_price": 100.0,
            "dirty_price": 100.0,
            "full_price": 100.0,
            "accrued_interest": 0.0,
            "ytm_pct": ytm_pct,
            "duration": 8.6,
            "convexity": 0.9,
            "source": "us_treasury_xml",
            "refresh_status": "READY",
            "missing_fields": [],
            "inferred_fields": {
                "clean_price": "cmt_par_proxy",
                "net_price": "cmt_par_proxy",
                "dirty_price": "cmt_par_proxy",
                "full_price": "cmt_par_proxy",
                "accrued_interest": "cmt_proxy",
                "duration": "cmt_duration_proxy",
                "convexity": "cmt_convexity_proxy",
            },
            "raw": {
                "asset_type": "INDIVIDUAL_BOND",
                "audit_profile": "UST_CMT_10Y",
                "tenor_label": "10Y",
                "proxy_kind": "UST_CMT_PROXY",
                "yield_basis": "nominal",
                "tracking_status": "READY",
            },
        }
    )


def _seed_tbill_snapshot(client, *, snapshot_date: str = "2026-04-23") -> str:
    return client.app.state.service.market_data_repository.upsert_bond_fixed_income_snapshot(
        {
            "id": f"bond-fixture-ust-bill-13w-{snapshot_date}",
            "instrument_id": "UST_BILL_3M",
            "symbol": "TBILL13W",
            "name": "UST T-Bill 13W",
            "instrument_type": "t_bill",
            "currency": "USD",
            "snapshot_date": snapshot_date,
            "maturity_date": "2026-07-23",
            "coupon_rate_pct": 0.0,
            "clean_price": 98.75,
            "net_price": 98.75,
            "dirty_price": 98.75,
            "full_price": 98.75,
            "accrued_interest": None,
            "ytm_pct": 5.21,
            "duration": 0.24,
            "convexity": 0.01,
            "source": "bond_fixed_income",
            "refresh_status": "READY",
            "missing_fields": ["accrued_interest"],
            "inferred_fields": {},
            "raw": {
                "asset_type": "T_BILL",
                "tenor_label": "13W",
                "audit_profile": "UST_BILL_3M",
                "discount_rate_pct": 5.18,
                "effective_duration": 0.24,
            },
        }
    )


def _seed_lqd_official_snapshot(client, *, snapshot_date: str = "2026-04-23") -> str:
    return client.app.state.service.market_data_repository.upsert_bond_fixed_income_snapshot(
        {
            "id": f"bond-fixture-lqd-official-{snapshot_date}",
            "instrument_id": "LQD",
            "symbol": "LQD",
            "name": "iShares iBoxx Investment Grade Corporate Bond ETF",
            "instrument_type": "etf",
            "currency": "USD",
            "snapshot_date": snapshot_date,
            "maturity_date": None,
            "coupon_rate_pct": None,
            "clean_price": 107.15,
            "net_price": 107.15,
            "dirty_price": 107.15,
            "full_price": 107.15,
            "accrued_interest": 0.0,
            "ytm_pct": 4.88,
            "duration": 8.2,
            "convexity": 0.64,
            "source": "bond_fixed_income",
            "refresh_status": "READY",
            "missing_fields": [],
            "inferred_fields": {},
            "raw": {
                "asset_type": "BOND_ETF",
                "tenor_label": "ETF",
                "audit_profile": "LQD",
                "sec_yield_30d_pct": 4.73,
                "credit_quality": "A-",
                "tracking_error_bps": 7.5,
                "tracking_error_source": "ISHARES_OFFICIAL",
                "tracking_status": "READY",
            },
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


def _seed_composition_preview_price_history(client) -> None:
    client.app.state.service.market_data_repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "Price Dataset",
            "status": "READY",
            "as_of": "2026-03-31",
            "start_date": "2026-01-31",
            "end_date": "2026-03-31",
            "row_count": 3,
            "source": "test_seed",
        },
        price_bars=[
            {"symbol": "IEF", "date": "2026-01-31", "close": 100.0, "adj_close": 100.0, "source": "test_seed"},
            {"symbol": "IEF", "date": "2026-02-28", "close": 101.0, "adj_close": 101.0, "source": "test_seed"},
            {"symbol": "IEF", "date": "2026-03-31", "close": 99.0, "adj_close": 99.0, "source": "test_seed"},
        ],
    )
    client.app.state.service.market_data_repository.replace_bars(
        "SPY",
        [
            {"date": "2026-01-31", "close": 100.0, "adj_close": 100.0},
            {"date": "2026-02-28", "close": 102.0, "adj_close": 102.0},
            {"date": "2026-03-31", "close": 101.0, "adj_close": 101.0},
        ],
    )
    client.app.state.service.market_data_repository.replace_bars(
        "phase1_cash_proxy",
        [
            {"date": "2026-01-31", "close": 100.0, "adj_close": 100.0},
            {"date": "2026-02-28", "close": 100.4, "adj_close": 100.4},
            {"date": "2026-03-31", "close": 100.8, "adj_close": 100.8},
        ],
    )


def _create_composition_with_seed_legs(client, asset_leg, cash_leg) -> dict:
    created = create_momentum_strategy(client, idempotency_key=f"composition-protect-{uuid4().hex}")
    strategy = created["strategy"]
    _seed_completed_run(client, strategy["id"], strategy["current_parameter_version_id"])
    strategy_leg_ref = f"strategy_leg::{strategy['id']}::{strategy['current_parameter_version_id']}"
    return assert_ok(
        client.post(
            "/compositions",
            json={
                "name": "Protected Overlay",
                "description": "Referenced leg protection fixture",
                "benchmark_definition": {"label": "S&P 500", "symbol": "SPY"},
                "rebalance_frequency": "quarterly",
                "cost_policy": {
                    "expense_ratio_bps": 10,
                    "turnover_budget_bps": 40,
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
            },
        )
    )


def _create_sleeve_os_composition(client) -> dict:
    _seed_composition_preview_price_history(client)
    asset_leg, cash_leg = _create_seed_legs(client)
    created = create_momentum_strategy(client, idempotency_key=f"sleeve-os-{uuid4().hex}")
    strategy = created["strategy"]
    _seed_completed_run(client, strategy["id"], strategy["current_parameter_version_id"])
    strategy_leg_ref = f"strategy_leg::{strategy['id']}::{strategy['current_parameter_version_id']}"
    return assert_ok(
        client.post(
            "/compositions",
            json={
                "name": "Sleeve OS Overlay",
                "description": "Composition-layer run fixture",
                "benchmark_definition": {"label": "S&P 500", "symbol": "SPY"},
                "rebalance_frequency": "monthly",
                "cost_policy": {
                    "expense_ratio_bps": 12,
                    "turnover_budget_bps": 30,
                    "trade_cost_bps": 6,
                },
                "legs": [
                    {
                        "leg_kind": "strategy",
                        "source_ref_id": strategy_leg_ref,
                        "weight_pct": 50,
                        "weight_locked": False,
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
                        "weight_locked": True,
                        "ordering": 3,
                    },
                ],
                "status": "ACTIVE",
            },
        )
    )


def _composition_update_legs(detail: dict) -> list[dict]:
    return [
        {
            "leg_kind": leg["leg_kind"],
            "source_ref_id": leg["source_ref_id"],
            "source_ref_type": leg.get("source_ref_type"),
            "display_name": leg.get("display_name"),
            "weight_pct": leg["weight_pct"],
            "weight_locked": leg["weight_locked"],
            "ordering": leg["ordering"],
            "config": leg.get("config") or {},
        }
        for leg in detail["normalized_legs"]
    ]


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
    assert asset_row["created_at"] == asset_leg["created_at"]
    assert asset_row["updated_at"] == asset_leg["updated_at"]
    assert asset_row["config"]["source_snapshot_id"] == "ds-price"
    assert asset_row["return_quality"]["issue_types"] == ["收益样本缺失", "对齐缺口"]
    assert cash_row["id"] == cash_leg["id"]
    assert cash_row["created_at"] == cash_leg["created_at"]
    assert cash_row["updated_at"] == cash_leg["updated_at"]
    assert cash_row["config"]["buffer_bps"] == 35.0
    assert cash_row["return_quality"]["issue_types"] == []
    assert cash_row["return_quality"]["missing_points"] == 0


def test_composition_detail_counts_transient_strategy_leg_reference(tmp_path):
    client, _ = create_test_client(tmp_path)
    asset_leg, cash_leg = _create_seed_legs(client)
    composition = _create_composition_with_seed_legs(client, asset_leg, cash_leg)

    detail = assert_ok(client.get(f"/compositions/{composition['id']}"))

    strategy_leg = next(
        leg for leg in detail["normalized_legs"] if leg["leg_kind"] == "strategy"
    )
    assert strategy_leg["source_ref_id"].startswith("strategy_leg::")
    assert strategy_leg["reference_summary"] == "Used in 1 saved composition"


def test_asset_and_cash_leg_definitions_can_be_edited(tmp_path):
    client, _ = create_test_client(tmp_path)
    asset_leg, cash_leg = _create_seed_legs(client)

    updated_asset = assert_ok(
        client.patch(
            f"/asset-legs/{asset_leg['id']}",
            json={
                "name": "US Treasury ETF Edited",
                "symbol": "IEF",
                "asset_kind": "BOND",
                "source_snapshot_id": "ds-price",
                "source_provider": "phase1_seed",
                "freeze_mode": "snapshot_locked",
                "notes": "Edited ballast note",
                "summary": {
                    "valuation_basis": "clean_plus_accrued",
                    "portfolio_roles": ["duration_stabilizer", "liquidity_reserve"],
                    "rebalance_affinity": "stable",
                    "maintenance_cadence": "eod_auto",
                },
            },
        )
    )
    updated_cash = assert_ok(
        client.patch(
            f"/cash-legs/{cash_leg['id']}",
            json={
                "name": "Cash Reserve Edited",
                "cash_rule_kind": "TARGET_BUFFER",
                "buffer_bps": 42,
                "yield_source": "SOFR",
                "freeze_mode": "manual",
                "notes": "Edited settlement buffer",
                "summary": {
                    "target_weight_pct": 20,
                    "rebalance_frequency": "quarterly",
                },
            },
        )
    )

    assert updated_asset["name"] == "US Treasury ETF Edited"
    assert updated_asset["summary"]["notes"] == "Edited ballast note"
    assert updated_asset["summary"]["valuation_basis"] == "clean_plus_accrued"
    assert updated_asset["summary"]["portfolio_roles"] == ["duration_stabilizer", "liquidity_reserve"]
    assert updated_cash["name"] == "Cash Reserve Edited"
    assert updated_cash["buffer_bps"] == 42.0
    assert updated_cash["summary"]["notes"] == "Edited settlement buffer"
    assert updated_cash["summary"]["target_weight_pct"] == 20
    assert updated_cash["summary"]["rebalance_frequency"] == "quarterly"

    inventory = assert_ok(client.get("/leg-inventory"))
    asset_row = next(row for row in inventory["rows"] if row["id"] == asset_leg["id"])
    cash_row = next(row for row in inventory["rows"] if row["id"] == cash_leg["id"])
    assert asset_row["name"] == "US Treasury ETF Edited"
    assert asset_row["config"]["summary"]["notes"] == "Edited ballast note"
    assert asset_row["config"]["summary"]["valuation_basis"] == "clean_plus_accrued"
    assert asset_row["config"]["summary"]["portfolio_roles"] == ["duration_stabilizer", "liquidity_reserve"]
    assert cash_row["name"] == "Cash Reserve Edited"
    assert cash_row["config"]["buffer_bps"] == 42.0
    assert cash_row["config"]["summary"]["notes"] == "Edited settlement buffer"
    assert cash_row["config"]["summary"]["target_weight_pct"] == 20
    assert cash_row["config"]["summary"]["rebalance_frequency"] == "quarterly"


def test_referenced_asset_and_cash_leg_definitions_are_copy_only(tmp_path):
    client, _ = create_test_client(tmp_path)
    asset_leg, cash_leg = _create_seed_legs(client)
    _create_composition_with_seed_legs(client, asset_leg, cash_leg)

    inventory = assert_ok(client.get("/leg-inventory"))
    asset_row = next(row for row in inventory["rows"] if row["id"] == asset_leg["id"])
    cash_row = next(row for row in inventory["rows"] if row["id"] == cash_leg["id"])
    assert asset_row["reference_count"] == 1
    assert cash_row["reference_count"] == 1
    assert "edit_leg_definition" not in asset_row["allowed_actions"]
    assert "edit_leg_definition" not in cash_row["allowed_actions"]

    asset_response = client.patch(
        f"/asset-legs/{asset_leg['id']}",
        json={
            "name": "Should Not Save",
            "symbol": "IEF",
            "asset_kind": "BOND",
            "source_snapshot_id": "ds-price",
            "source_provider": "phase1_seed",
            "freeze_mode": "snapshot_locked",
            "notes": "blocked",
        },
    )
    cash_response = client.patch(
        f"/cash-legs/{cash_leg['id']}",
        json={
            "name": "Should Not Save",
            "cash_rule_kind": "PURE_CASH",
            "buffer_bps": 12,
            "yield_source": "pure_cash",
            "freeze_mode": "manual",
            "notes": "blocked",
        },
    )

    assert asset_response.status_code == 409, asset_response.text
    assert cash_response.status_code == 409, cash_response.text
    assert asset_response.json()["blocking_code"] == "leg_reference_protected"
    assert cash_response.json()["blocking_code"] == "leg_reference_protected"

    refreshed = assert_ok(client.get("/leg-inventory"))
    refreshed_asset = next(row for row in refreshed["rows"] if row["id"] == asset_leg["id"])
    refreshed_cash = next(row for row in refreshed["rows"] if row["id"] == cash_leg["id"])
    assert refreshed_asset["name"] == "US Treasury ETF"
    assert refreshed_cash["name"] == "Cash Reserve"


def test_list_compositions_excludes_archived_entries(tmp_path):
    client, _ = create_test_client(tmp_path)
    asset_leg, cash_leg = _create_seed_legs(client)
    composition = _create_composition_with_seed_legs(client, asset_leg, cash_leg)

    assert_ok(
        client.patch(
            f"/compositions/{composition['id']}",
            json={"status": "ARCHIVED"},
        )
    )

    listed = assert_ok(client.get("/compositions"))
    assert listed == []


def test_list_compositions_uses_freeze_generation_for_version_label_without_formal_version(tmp_path):
    client, _ = create_test_client(tmp_path)
    composition = _create_sleeve_os_composition(client)
    service = client.app.state.service

    service.storage.execute(
        "UPDATE compositions SET revision = ?, current_freeze_generation = ? WHERE id = ?",
        (7, 5, composition["id"]),
    )
    service.storage.execute("DELETE FROM composition_versions WHERE composition_id = ?", (composition["id"],))

    listed = assert_ok(client.get("/compositions"))
    list_item = next(item for item in listed if item["id"] == composition["id"])
    assert list_item["version_label"] == "v5"
    assert "：" in list_item["primary_diagnosis"]["diagnosis_label"]
    assert all(item["issue_type"] != "审计门禁硬阻断" for item in list_item["diagnoses"])


def test_logic_drift_status_diagnosis_has_actionable_route(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    diagnoses = service._composition_status_diagnoses(
        {
            "id": "composition-drift",
            "return_quality_summary": {
                "status": "verified",
                "aligned_points": 120,
                "missing_points": 0,
                "fallback_used": False,
            },
            "source_integrity": [
                {
                    "leg_id": "leg-drift",
                    "display_name": "Drifted leg",
                    "source_ref_id": "strategy_leg::strat_drift::strat_drift-v1",
                    "current_ref_id": "strategy_leg::strat_drift::strat_drift-v1",
                    "freeze_hash": "frozen-hash",
                    "signature_status": "stale",
                    "drift_status": "drifted",
                    "alerts": ["Current source version differs from the frozen source signature."],
                }
            ],
        },
        composition_id="composition-drift",
    )

    drift = next(item for item in diagnoses if item["issue_type"] == "逻辑一致性漂移")
    assert any(
        action["action_kind"] == "execute"
        and action["action_key"] == "refresh_source_freezes"
        and action["label"] == "确认并重新冻结来源指纹"
        for action in drift["actions"]
    )
    assert any(
        action["action_kind"] == "open_new_tab"
        and action["route"] == "/compositions/workbench?composition_id=composition-drift"
        for action in drift["actions"]
    )


def test_short_return_sample_diagnosis_names_sample_and_offers_real_actions(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    diagnoses = service._composition_status_diagnoses(
        {
            "id": "composition-short",
            "return_quality_summary": {
                "status": "verified",
                "aligned_points": 72,
                "missing_points": 9,
                "fallback_used": False,
                "leg_quality": [
                    {
                        "leg_id": "leg-short",
                        "display_name": "标普动量策略腿",
                        "leg_kind": "strategy",
                        "source_ref_id": "strategy_leg::spy::v1",
                        "sample_points": 72,
                        "aligned_points": 72,
                        "missing_points": 0,
                        "coverage_pct": 100.0,
                        "window_start": "2020-01",
                        "window_end": "2025-12",
                        "issue_types": ["收益样本不足"],
                    },
                    {
                        "leg_id": "leg-gap",
                        "display_name": "QQQ 网格策略腿",
                        "leg_kind": "strategy",
                        "source_ref_id": "strategy_leg::qqq::v2",
                        "sample_points": 140,
                        "aligned_points": 63,
                        "missing_points": 9,
                        "coverage_pct": 87.5,
                        "window_start": "2014-01",
                        "window_end": "2025-12",
                        "issue_types": ["对齐缺口"],
                    },
                ],
            },
            "source_integrity": [],
        },
        composition_id="composition-short",
    )

    short_sample = next(item for item in diagnoses if item["issue_type"] == "收益样本窗口不足")
    assert short_sample["diagnosis_type"] == "return_sample_window_short"
    assert short_sample["diagnosis_label"] == "待校准：收益样本窗口不足"
    assert "月度收益样本只有 72 个月" in short_sample["frontend_explanation"]
    assert "约 6 年" in short_sample["frontend_explanation"]
    assert "另有 9 个对齐缺口" in short_sample["frontend_explanation"]
    assert short_sample["debug_facts"]["sample_short_legs"] == ["标普动量策略腿"]
    assert short_sample["debug_facts"]["alignment_gap_legs"] == ["QQQ 网格策略腿"]
    assert short_sample["debug_facts"]["leg_quality"][0]["sample_points"] == 72
    assert "回组合工作台替换或补齐更长历史来源" in short_sample["action"]
    assert "短窗口回测只用于复核，不是补足样本" in short_sample["action"]
    assert "短窗口回测只能作为待校准复核" in short_sample["resolution_criteria"]
    assert any(
        action["action_key"] == "open_composition_workbench"
        and action["route"] == "/compositions/workbench?composition_id=composition-short"
        for action in short_sample["actions"]
    )
    assert any(
        action["action_key"] == "open_backtest_config"
        and action["route"] == "/compositions/composition-short/backtest-runs/new"
        and action["label"] == "按短样本配置回测"
        for action in short_sample["actions"]
    )


def test_composition_detail_reuses_current_list_status_diagnosis(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    composition = _create_sleeve_os_composition(client)
    service = client.app.state.service
    list_diagnosis = {
        "status": "待校准",
        "issue_type": "收益样本窗口不足",
        "diagnosis_type": "return_sample_window_short",
        "diagnosis_label": "待校准：收益样本窗口不足",
        "frontend_explanation": "当前组合可对齐的月度收益样本只有 106 个月（约 8.8 年），低于 10 年验证门槛 120 个月。",
        "action": "回组合工作台替换或补齐更长历史来源；短窗口回测只用于复核，不是补足样本。",
        "resolution_criteria": "组合月度收益样本达到 120 个月以上；短窗口回测只能作为待校准复核，不会关闭该状态。",
        "actions": [
            {
                "label": "调整来源样本",
                "action_key": "open_composition_workbench",
                "action_kind": "open_new_tab",
                "route": f"/compositions/workbench?composition_id={composition['id']}",
                "enabled": True,
            }
        ],
        "debug_facts": {
            "aligned_points": 106,
            "missing_points": 212,
            "leg_quality": [
                {
                    "leg_id": "strategy-leg-spy",
                    "display_name": "标普动量策略腿",
                    "sample_points": 106,
                    "aligned_points": 106,
                    "missing_points": 0,
                    "coverage_pct": 100.0,
                    "issue_types": ["收益样本不足"],
                },
                {
                    "leg_id": "strategy-leg-gap",
                    "display_name": "QQQ 网格策略腿",
                    "sample_points": 318,
                    "aligned_points": 106,
                    "missing_points": 212,
                    "coverage_pct": 33.3,
                    "issue_types": ["对齐缺口"],
                },
            ],
        },
    }

    monkeypatch.setattr(
        service,
        "list_compositions",
        lambda: [
            {
                "id": composition["id"],
                "primary_diagnosis": list_diagnosis,
                "diagnoses": [list_diagnosis],
            }
        ],
    )

    detail = assert_ok(client.get(f"/compositions/{composition['id']}"))

    assert detail["primary_diagnosis"]["diagnosis_label"] == "待校准：收益样本窗口不足"
    assert detail["primary_diagnosis"]["debug_facts"]["aligned_points"] == 106
    assert detail["primary_diagnosis"]["debug_facts"]["leg_quality"][0]["display_name"] == "标普动量策略腿"
    assert detail["primary_diagnosis"]["debug_facts"]["leg_quality"][1]["missing_points"] == 212
    assert len(detail["diagnoses"]) == 1
    assert detail["diagnoses"][0]["diagnosis_type"] == "return_sample_window_short"
    assert detail["diagnoses"][0]["debug_facts"]["missing_points"] == 212


def test_composition_detail_keeps_list_status_when_detail_quality_refreshes(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    composition = _create_sleeve_os_composition(client)
    service = client.app.state.service
    list_diagnosis = {
        "status": "待校准",
        "issue_type": "收益样本窗口不足",
        "diagnosis_type": "return_sample_window_short",
        "diagnosis_label": "待校准：收益样本窗口不足",
        "frontend_explanation": "当前组合可对齐的月度收益样本只有 106 个月（约 8.8 年），低于 10 年验证门槛 120 个月。",
        "action": "回组合工作台替换或补齐更长历史来源；短窗口回测只用于复核，不是补足样本。",
        "resolution_criteria": "组合月度收益样本达到 120 个月以上；短窗口回测只能作为待校准复核，不会关闭该状态。",
        "actions": [
            {
                "label": "调整来源样本",
                "action_key": "open_composition_workbench",
                "action_kind": "open_new_tab",
                "route": f"/compositions/workbench?composition_id={composition['id']}",
                "enabled": True,
            }
        ],
        "debug_facts": {
            "aligned_points": 106,
            "missing_points": 212,
            "fallback_used": True,
            "source_integrity_count": 3,
        },
    }

    monkeypatch.setattr(
        service,
        "list_compositions",
        lambda: [
            {
                "id": composition["id"],
                "primary_diagnosis": list_diagnosis,
                "diagnoses": [list_diagnosis],
            }
        ],
    )

    detail = assert_ok(client.get(f"/compositions/{composition['id']}"))

    assert detail["primary_diagnosis"]["diagnosis_label"] == "待校准：收益样本窗口不足"
    assert detail["primary_diagnosis"]["debug_facts"]["aligned_points"] == 106
    assert detail["primary_diagnosis"]["debug_facts"]["missing_points"] == 212
    assert detail["diagnoses"] == [detail["primary_diagnosis"]]


def test_leg_inventory_reference_counts_ignore_archived_compositions(tmp_path):
    client, _ = create_test_client(tmp_path)
    asset_leg, cash_leg = _create_seed_legs(client)
    composition = _create_composition_with_seed_legs(client, asset_leg, cash_leg)

    archived = assert_ok(
        client.patch(
            f"/compositions/{composition['id']}",
            json={"status": "ARCHIVED"},
        )
    )
    assert archived["status"] == "ARCHIVED"

    inventory = assert_ok(client.get("/leg-inventory"))
    asset_row = next(row for row in inventory["rows"] if row["id"] == asset_leg["id"])
    cash_row = next(row for row in inventory["rows"] if row["id"] == cash_leg["id"])

    assert asset_row["reference_count"] == 0
    assert cash_row["reference_count"] == 0
    assert "edit_leg_definition" in asset_row["allowed_actions"]
    assert "edit_leg_definition" in cash_row["allowed_actions"]


def test_unreferenced_asset_and_cash_legs_can_be_archived(tmp_path):
    client, _ = create_test_client(tmp_path)
    asset_leg, cash_leg = _create_seed_legs(client)

    archived_asset = assert_ok(
        client.patch(
            f"/asset-legs/{asset_leg['id']}",
            json={"status": "ARCHIVED"},
        )
    )
    archived_cash = assert_ok(
        client.patch(
            f"/cash-legs/{cash_leg['id']}",
            json={"status": "ARCHIVED"},
        )
    )

    assert archived_asset["status"] == "ARCHIVED"
    assert archived_cash["status"] == "ARCHIVED"

    inventory = assert_ok(client.get("/leg-inventory"))
    assert [row for row in inventory["rows"] if row["id"] == asset_leg["id"]] == []
    assert [row for row in inventory["rows"] if row["id"] == cash_leg["id"]] == []

    asset_row = client.app.state.service.storage.fetch_one(
        "SELECT status, deleted_at, deleted_reason FROM asset_leg_definitions WHERE id = ?",
        (asset_leg["id"],),
    )
    cash_row = client.app.state.service.storage.fetch_one(
        "SELECT status, deleted_at, deleted_reason FROM cash_leg_definitions WHERE id = ?",
        (cash_leg["id"],),
    )
    assert asset_row is not None
    assert cash_row is not None
    assert asset_row["status"] == "ARCHIVED"
    assert cash_row["status"] == "ARCHIVED"
    assert asset_row["deleted_at"] is not None
    assert cash_row["deleted_at"] is not None
    assert asset_row["deleted_reason"] == "user_archived"
    assert cash_row["deleted_reason"] == "user_archived"


def test_same_source_leg_copy_requires_semantic_change(tmp_path):
    client, _ = create_test_client(tmp_path)
    asset_leg, cash_leg = _create_seed_legs(client)

    duplicate_asset = client.post(
        "/asset-legs",
        json={
            "name": "US Treasury ETF Renamed Copy",
            "symbol": "IEF",
            "asset_kind": "BOND",
            "source_snapshot_id": "ds-price",
            "source_provider": "phase1_seed",
            "freeze_mode": "snapshot_locked",
            "notes": "name-only copy should fail",
        },
    )
    assert duplicate_asset.status_code == 409, duplicate_asset.text
    assert duplicate_asset.json()["blocking_code"] == "duplicate_leg_definition"

    semantic_asset = assert_ok(
        client.post(
            "/asset-legs",
            json={
                "name": "US Treasury ETF Full Price Copy",
                "symbol": "IEF",
                "asset_kind": "BOND",
                "source_snapshot_id": "ds-price",
                "source_provider": "phase1_seed",
                "freeze_mode": "snapshot_locked",
                "summary": {
                    "valuation_basis": "full_price",
                    "portfolio_roles": ["duration_stabilizer"],
                    "rebalance_affinity": "stable",
                    "maintenance_cadence": "eod_auto",
                },
            },
        )
    )
    assert semantic_asset["id"] != asset_leg["id"]
    assert semantic_asset["summary"]["valuation_basis"] == "full_price"

    duplicate_cash = client.post(
        "/cash-legs",
        json={
            "name": "Cash Reserve Renamed Copy",
            "cash_rule_kind": cash_leg["cash_rule_kind"],
            "buffer_bps": cash_leg["buffer_bps"],
            "yield_source": cash_leg["yield_source"],
            "freeze_mode": cash_leg["freeze_mode"],
        },
    )
    assert duplicate_cash.status_code == 409, duplicate_cash.text
    assert duplicate_cash.json()["blocking_code"] == "duplicate_leg_definition"

    semantic_cash = assert_ok(
        client.post(
            "/cash-legs",
            json={
                "name": "Cash Reserve Monthly Copy",
                "cash_rule_kind": cash_leg["cash_rule_kind"],
                "buffer_bps": cash_leg["buffer_bps"],
                "yield_source": cash_leg["yield_source"],
                "freeze_mode": cash_leg["freeze_mode"],
                "summary": {
                    "target_weight_pct": 20,
                    "rebalance_frequency": "monthly",
                },
            },
        )
    )
    assert semantic_cash["id"] != cash_leg["id"]
    assert semantic_cash["summary"]["rebalance_frequency"] == "monthly"

    inventory = assert_ok(client.get("/leg-inventory"))
    asset_row = next(row for row in inventory["rows"] if row["id"] == semantic_asset["id"])
    cash_row = next(row for row in inventory["rows"] if row["id"] == semantic_cash["id"])
    assert asset_row["config"]["summary"]["valuation_basis"] == "full_price"
    assert asset_row["config"]["summary"]["portfolio_roles"] == ["duration_stabilizer"]
    assert cash_row["config"]["summary"]["target_weight_pct"] == 20
    assert cash_row["config"]["summary"]["rebalance_frequency"] == "monthly"


def test_composition_preview_create_update_and_list_flow(tmp_path):
    client, _ = create_test_client(tmp_path)
    created = create_momentum_strategy(client, idempotency_key="composition-workflow-strategy")
    strategy = created["strategy"]
    _seed_completed_run(client, strategy["id"], strategy["current_parameter_version_id"])
    _seed_composition_preview_price_history(client)
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
        "composition_audit_events": _table_count(client, "composition_audit_events"),
    }
    preview = assert_ok(client.post("/compositions/preview", json=preview_payload))
    counts_after_preview = {
        "compositions": _table_count(client, "compositions"),
        "composition_legs": _table_count(client, "composition_legs"),
        "composition_source_freezes": _table_count(client, "composition_source_freezes"),
        "composition_audit_events": _table_count(client, "composition_audit_events"),
    }

    assert counts_after_preview == counts_before_preview
    assert preview["weight_summary"]["total_weight_pct"] == 100.0
    assert preview["weight_summary"]["within_tolerance"] is True
    assert len(preview["normalized_legs"]) == 3
    assert [point["label"] for point in preview["returns_preview"]] == ["2026-01", "2026-02", "2026-03"]
    assert [point["label"] for point in preview["benchmark_series"]] == ["2026-01", "2026-02", "2026-03"]
    assert [point["label"] for point in preview["spread_series"]] == ["2026-01", "2026-02", "2026-03"]
    assert preview["returns_preview"][1]["portfolio_return_pct"] == pytest.approx(1.98, abs=0.001)
    assert preview["returns_preview"][1]["gross_return_pct"] == pytest.approx(
        preview["returns_preview"][1]["portfolio_return_pct"],
        abs=0.001,
    )
    assert preview["returns_preview"][1]["net_return_pct"] < preview["returns_preview"][1]["gross_return_pct"]
    assert preview["returns_preview"][1]["total_cost_drag_pct"] > 0
    assert preview["returns_preview"][1]["cumulative_net_return_pct"] < preview["returns_preview"][1]["cumulative_return_pct"]
    assert preview["returns_preview"][2]["portfolio_return_pct"] == pytest.approx(1.2298, abs=0.001)
    assert preview["returns_preview"][2]["cumulative_return_pct"] == pytest.approx(3.2342, abs=0.001)
    assert preview["benchmark_series"][1]["benchmark_return_pct"] == pytest.approx(2.0, abs=0.001)
    assert preview["benchmark_series"][2]["cumulative_return_pct"] == pytest.approx(1.0, abs=0.001)
    assert preview["spread_series"][2]["spread_pct"] == pytest.approx(2.2342, abs=0.001)
    assert len(preview["correlation_matrix"]) == 9
    assert len(preview["risk_contribution_preview"]) == 3
    assert preview["return_quality_summary"]["aligned_points"] == 3
    assert preview["return_quality_summary"]["fallback_used"] is False
    assert preview["rebalance_events"]
    assert preview["rebalance_events"][0]["turnover_pct"] >= 0
    assert len(preview["source_integrity"]) == 3
    assert "marginal_contribution_pct" in preview["risk_contribution_preview"][0]
    assert "budget_usage_pct" in preview["risk_contribution_preview"][0]
    assert len(preview["composition_score"]["factors"]) == 4
    assert preview["maintenance_cost_summary"]["notes"][-1] == "Composition preview is aggregated from the latest real leg return series."

    created_composition = assert_ok(
        client.post("/compositions", json={**preview_payload, "status": "DRAFT"})
    )
    composition_id = created_composition["id"]

    assert created_composition["name"] == "Balanced Overlay"
    assert created_composition["status"] == "DRAFT"
    assert len(created_composition["source_evidence"]) == 3
    assert len(created_composition["audit_trail"]) >= 3
    assert [item["action"] for item in created_composition["audit_trail"][:4]] == [
        "created",
        "source_freeze",
        "rebalance_check",
        "status",
    ]
    audit_count_after_create = _table_count(client, "composition_audit_events")
    assert audit_count_after_create >= 4
    assert created_composition["source_evidence"][0]["signature_status"] in {"verified", "stale"}
    assert created_composition["source_evidence"][0]["drift_status"]
    assert len(created_composition["source_integrity"]) == 3
    assert created_composition["hero_summary"]["benchmark_label"] == "S&P 500"
    assert created_composition["kpis"][0]["key"] == "composition_score"
    kpi_keys = {item["key"] for item in created_composition["kpis"]}
    assert {"sharpe", "sortino", "volatility", "cash_weight", "beta_exposure"}.issubset(kpi_keys)
    created_sharpe = next(item["value"] for item in created_composition["kpis"] if item["key"] == "sharpe")
    created_beta = next(item["value"] for item in created_composition["kpis"] if item["key"] == "beta_exposure")
    assert created_beta == pytest.approx(0.3607, abs=0.001)
    assert created_composition["scenario_summary"]["base_case"]["label"]
    assert created_composition["scenario_summary"]["base_case"]["expected_drawdown_pct"] < 0
    assert created_composition["scenario_summary"]["stress_case"]["label"]
    assert created_composition["scenario_summary"]["stress_case"]["expected_drawdown_pct"] < 0
    assert len(created_composition["scenario_summary"]["cases"]) == 3
    assert "deterministic phase 1 approximations" not in (
        created_composition["scenario_summary"]["dispersion_note"] or ""
    ).lower()
    assert _table_count(client, "composition_source_freezes") == 3

    status_only = assert_ok(
        client.patch(f"/compositions/{composition_id}", json={"status": "ACTIVE"})
    )
    assert status_only["status"] == "ACTIVE"
    assert _table_count(client, "composition_source_freezes") == 3
    assert _table_count(client, "composition_audit_events") == audit_count_after_create + 1

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
    assert frozen_asset["freeze_hash"]
    assert frozen_asset["drift_status"] == "drifted"
    assert any("differs from the frozen source signature" in alert for alert in frozen_asset["alerts"])
    assert frozen_detail["audit_trail"][0]["action"] == "created"

    refrozen = assert_ok(
        client.post(
            f"/compositions/{composition_id}/source-freezes/refresh",
            json={"reason": "Reviewed the current source fingerprint and accepted it."},
        )
    )
    refrozen_asset = next(
        item
        for item in refrozen["source_evidence"]
        if item["freeze_ref_id"] == asset_leg["id"]
    )
    assert refrozen_asset["snapshot"]["display_name"] == "Drifted Treasury ETF"
    assert refrozen_asset["drift_status"] == "current"
    assert refrozen["primary_diagnosis"]["diagnosis_type"] != "source_logic_drift"
    assert _table_count(client, "composition_source_freezes") == 6
    assert refrozen["audit_trail"][-4]["action"] == "source_refreeze"

    coverage_run = assert_ok(
        client.post(
            f"/compositions/{composition_id}/backtest-runs",
            json={"idempotency_key": "coverage-10y", "horizon_years": 10},
        )
    )
    listed = assert_ok(client.get("/compositions"))
    list_item = next(item for item in listed if item["id"] == composition_id)
    assert all(
        diagnosis["diagnosis_type"] != "source_logic_drift"
        for diagnosis in list_item["diagnoses"]
    )
    assert all(
        item["drift_status"] == "current"
        for item in list_item["source_integrity"]
    )
    assert list_item["leg_count"] == 3
    assert list_item["benchmark_label"] == "S&P 500"
    assert list_item["sharpe"] == pytest.approx(created_sharpe)
    assert list_item["backtest_period_coverage"] == [
        {
            "period": "10Y",
            "status": "covered",
            "run_id": coverage_run["run_id"],
            "label": "10Y 已覆盖",
            "detail": "完成",
            "completed_at": coverage_run["completed_at"],
        },
        {"period": "20Y", "status": "missing", "label": "20Y 待补齐"},
        {"period": "30Y", "status": "missing", "label": "30Y 待补齐"},
    ]

    updated = assert_ok(
        client.patch(
            f"/compositions/{composition_id}",
            json={
                "name": "Balanced Overlay v2",
                "status": "ACTIVE",
                "version_reason": "Rebalance sleeve weights during composition workflow regression.",
                "version_change_summary": "Strategy sleeve -5pt; asset ballast +5pt.",
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
    assert updated["audit_trail"][-4]["action"] == "structure_patch"

    fetched = assert_ok(client.get(f"/compositions/{composition_id}"))
    assert fetched["id"] == composition_id
    assert fetched["name"] == "Balanced Overlay v2"
    assert fetched["status"] == "ACTIVE"
    assert fetched["current_composition_version_number"] == 3
    assert fetched["current_composition_version_label"] == "当前配置版本 v3"
    assert len(fetched["source_evidence"]) == 3
    assert fetched["audit_trail"]
    assert fetched["rebalance_events"]
    assert fetched["latest_activity_label"].startswith("Updated ")

    refreshed_inventory = assert_ok(client.get("/leg-inventory"))
    assert all(row["id"] != strategy_leg_ref for row in refreshed_inventory["rows"])


def test_composition_detail_refreshes_saved_analysis_missing_beta_kpi(tmp_path):
    client, _ = create_test_client(tmp_path)
    created = create_momentum_strategy(client, idempotency_key="composition-beta-refresh-strategy")
    strategy = created["strategy"]
    _seed_completed_run(client, strategy["id"], strategy["current_parameter_version_id"])
    _seed_composition_preview_price_history(client)
    asset_leg, cash_leg = _create_seed_legs(client)
    strategy_leg_ref = f"strategy_leg::{strategy['id']}::{strategy['current_parameter_version_id']}"
    payload = {
        "name": "Beta Refresh Overlay",
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
    created_composition = assert_ok(client.post("/compositions", json={**payload, "status": "ACTIVE"}))
    created_beta = next(item["value"] for item in created_composition["kpis"] if item["key"] == "beta_exposure")

    stale_payload = dict(created_composition)
    stale_payload["kpis"] = [
        dict(item)
        for item in created_composition["kpis"]
        if item.get("key") != "beta_exposure"
    ]
    client.app.state.service.storage.execute(
        "UPDATE compositions SET analysis_json = ? WHERE id = ?",
        (json.dumps(stale_payload), created_composition["id"]),
    )

    fetched = assert_ok(client.get(f"/compositions/{created_composition['id']}"))
    fetched_beta = next(item["value"] for item in fetched["kpis"] if item["key"] == "beta_exposure")
    assert fetched_beta == pytest.approx(created_beta, abs=0.0001)


def test_composition_backtest_run_orders_netting_and_exports(tmp_path):
    client, _ = create_test_client(tmp_path)
    composition = _create_sleeve_os_composition(client)
    composition_detail = assert_ok(client.get(f"/compositions/{composition['id']}"))
    strategy_run_id = next(
        leg["config"]["latest_run_id"]
        for leg in composition_detail["normalized_legs"]
        if leg["leg_kind"] == "strategy"
    )
    client.app.state.service.storage.execute(
        "UPDATE backtest_runs SET trades_json = ? WHERE id = ?",
        (
            json.dumps(
                [
                    {
                        "trade_date": "2026-01-31",
                        "symbol": "QQQ",
                        "weight_after": 0.6,
                        "price": 405.25,
                        "reason": "momentum:rank",
                    },
                    {
                        "trade_date": "2026-01-31",
                        "symbol": "MSFT",
                        "weight_after": 0.4,
                        "price": 318.5,
                        "reason": "momentum:rank",
                    },
                    {
                        "trade_date": "2026-02-28",
                        "symbol": "QQQ",
                        "weight_after": 0.25,
                        "price": 410.5,
                        "reason": "momentum:semiannual",
                    },
                    {
                        "trade_date": "2026-02-28",
                        "symbol": "MSFT",
                        "weight_after": 0.0,
                        "price": 320.0,
                        "reason": "momentum:semiannual",
                    },
                    {
                        "trade_date": "2026-02-28",
                        "symbol": "NVDA",
                        "weight_after": 0.75,
                        "price": 790.0,
                        "reason": "momentum:rank",
                    },
                ]
            ),
            strategy_run_id,
        ),
    )

    created_run = assert_ok(
        client.post(
            f"/compositions/{composition['id']}/backtest-runs",
            json={"idempotency_key": "sleeve-run-001", "horizon_years": 10},
        )
    )
    run_id = created_run["run_id"]
    run_version_label = created_run["current_composition_version_label"]

    assert created_run["composition_id"] == composition["id"]
    assert created_run["status"] in {"COMPLETED", "COMPLETED_WITH_WARNINGS"}
    assert created_run["returns_preview"] == composition["returns_preview"]
    assert created_run["benchmark_series"] == composition["benchmark_series"]
    assert created_run["summary"]["order_count"] > 0
    assert created_run["summary"]["quality_label"].endswith("composition_detail_preview")
    assert "full-window composition rebalance events" in created_run["summary"]["evidence_label"]
    assert created_run["evidence"]["data_footprint"]["returns_preview_points"] == len(composition["returns_preview"])
    assert created_run["evidence_grade"] in {"A", "B", "C"}
    assert created_run["scenario_anchors"]
    assert created_run["risk_budget_timeline"]
    assert created_run["promotion_readiness"]["required_steps"] == [
        "diff_review",
        "constraint_check",
        "migration_cost_review",
        "evidence_gate",
    ]

    legacy_run_row = client.app.state.service.storage.fetch_one(
        "SELECT result_json FROM composition_backtest_runs WHERE id = ?",
        (run_id,),
    )
    legacy_payload = json.loads(legacy_run_row["result_json"])
    legacy_payload.pop("current_composition_version_label", None)
    legacy_payload.pop("current_composition_version_number", None)
    legacy_payload["summary"].pop("composition_version_label", None)
    legacy_payload["summary"].pop("composition_version_number", None)
    client.app.state.service.storage.execute(
        "UPDATE composition_backtest_runs SET result_json = ? WHERE id = ?",
        (json.dumps(legacy_payload), run_id),
    )
    refreshed = assert_ok(
        client.post(
            f"/compositions/{composition['id']}/source-freezes/refresh",
            json={"reason": "Validate history rows keep the run-time composition version."},
        )
    )
    assert refreshed["current_composition_version_label"] != run_version_label
    refreshed_generation = refreshed["current_composition_version_number"]
    client.app.state.service.storage.execute(
        """
        UPDATE composition_source_freezes
        SET created_at = ?, updated_at = ?
        WHERE composition_id = ?
          AND freeze_generation = ?
        """,
        ("2099-01-01T00:00:00Z", "2099-01-01T00:00:00Z", composition["id"], refreshed_generation),
    )

    detail_with_history = assert_ok(client.get(f"/compositions/{composition['id']}"))
    history_row = detail_with_history["backtest_history"][0]
    assert history_row["run_id"] == run_id
    assert history_row["composition_version_label"] == run_version_label
    assert history_row["composition_version_label"] != detail_with_history["current_composition_version_label"]
    assert history_row["period_label"] == "10Y"
    assert history_row["annualized_return"] == created_run["summary"]["annualized_return"]
    assert history_row["sharpe"] == created_run["summary"]["sharpe"]
    assert history_row["strategy_versions"]
    assert all(
        item["source_ref_id"].startswith("strategy_leg::")
        for item in history_row["strategy_versions"]
    )

    fetched_run = assert_ok(client.get(f"/compositions/{composition['id']}/backtest-runs/{run_id}"))
    assert fetched_run["id"] == run_id
    assert fetched_run["audit_trail"]
    assert fetched_run["source_integrity"]
    assert fetched_run["diagnostics"]["top_holdings"]
    assert any(item["symbol"] == "IEF" for item in fetched_run["diagnostics"]["top_holdings"])
    assert all(item["symbol"] != "STRATEGY" for item in fetched_run["diagnostics"]["top_holdings"])

    orders = assert_ok(client.get(f"/compositions/{composition['id']}/backtest-runs/{run_id}/orders"))
    assert orders["total"] == created_run["summary"]["order_count"]
    assert orders["generated_from"] == "composition_rebalance_events_and_strategy_trades"
    first_event_id = orders["items"][0]["event_id"]
    first_event_orders = [item for item in orders["items"] if item["event_id"] == first_event_id]
    assert first_event_orders
    assert {item["side"] for item in first_event_orders} == {"BUY"}
    assert all(item["execution_kind"] == "simulated_initial_allocation" for item in first_event_orders)
    assert {"QQQ", "MSFT"}.issubset({item["symbol"] for item in first_event_orders})
    assert all(item["price"] is not None for item in orders["items"])
    assert all(item["fee_amount"] is not None for item in orders["items"])
    assert any("组合建仓" in item["trigger_reason"] for item in first_event_orders)
    assert any("穿透来源" in item["trigger_reason"] for item in orders["items"])
    assert any("组合再平衡" in item["trigger_reason"] for item in orders["items"])
    strategy_rebalance_orders = [
        item
        for item in orders["items"]
        if item["execution_kind"] == "simulated_rebalance_instruction"
        and item["source_leg_kind"] == "strategy"
    ]
    assert strategy_rebalance_orders
    assert all("策略内逻辑" not in item["trigger_reason"] for item in strategy_rebalance_orders)
    assert all("组合再平衡" in item["trigger_reason"] for item in strategy_rebalance_orders)
    assert all("穿透来源" in item["trigger_reason"] for item in strategy_rebalance_orders)
    strategy_internal_orders = [
        item
        for item in orders["items"]
        if item["execution_kind"] == "simulated_strategy_internal_order"
        and item["source_leg_kind"] == "strategy"
    ]
    assert strategy_internal_orders
    assert {"QQQ", "MSFT", "NVDA"}.issubset({item["symbol"] for item in strategy_internal_orders})
    assert any(
        item["symbol"] == "NVDA"
        and item["side"] == "BUY"
        and item["event_date"] == "2026-02-28"
        and "策略内逻辑" in item["trigger_reason"]
        and "组合再平衡" not in item["trigger_reason"]
        for item in strategy_internal_orders
    )
    assert "STRATEGY" not in {item["symbol"] for item in orders["items"]}
    assert {"QQQ", "MSFT"}.issubset({item["symbol"] for item in orders["items"]})

    strategy_filtered = assert_ok(
        client.get(f"/compositions/{composition['id']}/backtest-runs/{run_id}/orders?symbol=QQQ")
    )
    assert strategy_filtered["symbol_filter"] == "QQQ"
    assert strategy_filtered["total"] > 0
    assert {item["symbol"] for item in strategy_filtered["items"]} == {"QQQ"}

    source_leg_name = next(
        item["source_leg_name"]
        for item in first_event_orders
        if item["symbol"] == "MSFT"
    )
    source_filtered = assert_ok(
        client.get(
            f"/compositions/{composition['id']}/backtest-runs/{run_id}/orders?source_leg={source_leg_name}"
        )
    )
    assert source_filtered["filters"]["source_leg"] == source_leg_name
    assert source_filtered["total"] > 0
    assert {item["source_leg_name"] for item in source_filtered["items"]} == {source_leg_name}

    filtered = assert_ok(
        client.get(f"/compositions/{composition['id']}/backtest-runs/{run_id}/orders?symbol=IEF")
    )
    assert filtered["symbol_filter"] == "IEF"
    assert filtered["total"] > 0
    assert {item["symbol"] for item in filtered["items"]} == {"IEF"}

    scenario_filtered = assert_ok(
        client.get(
            f"/compositions/{composition['id']}/backtest-runs/{run_id}/orders?scenario={created_run['scenario_anchors'][0]['id']}"
        )
    )
    assert scenario_filtered["filters"]["scenario"] == created_run["scenario_anchors"][0]["id"]

    global_runs = assert_ok(client.get("/compositions/backtest-runs"))
    assert any(item["run_id"] == run_id for item in global_runs["items"])

    order = filtered["items"][0]
    netting = assert_ok(
        client.get(
            f"/compositions/{composition['id']}/backtest-runs/{run_id}/orders/{order['id']}/netting"
        )
    )
    assert netting["order_id"] == order["id"]
    assert netting["symbol"] == "IEF"
    assert netting["before_netting"]["requested_quantity"] == pytest.approx(order["quantity"])
    assert (
        netting["after_netting"]["internal_net_quantity"]
        + netting["after_netting"]["external_quantity"]
    ) == pytest.approx(order["quantity"])
    assert netting["generated_from"] == "composition_rebalance_events_and_strategy_trades"

    csv_response = client.get(
        f"/compositions/{composition['id']}/backtest-runs/{run_id}/orders/export?format=csv&symbol=IEF"
    )
    assert csv_response.status_code == 200, csv_response.text
    assert csv_response.headers["content-type"].startswith("text/csv")
    assert "标的" in csv_response.text
    assert "IEF" in csv_response.text
    assert "组合" in csv_response.text
    assert "99." in csv_response.text

    xlsx_response = client.get(
        f"/compositions/{composition['id']}/backtest-runs/{run_id}/orders/export?format=xlsx"
    )
    assert xlsx_response.status_code == 200, xlsx_response.text
    assert xlsx_response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert xlsx_response.headers["content-disposition"].endswith('.xlsx"')
    assert xlsx_response.content.startswith(b"PK")


def test_composition_backtest_run_accepts_frozen_source_run_deep_link(tmp_path):
    client, _ = create_test_client(tmp_path)
    composition = _create_sleeve_os_composition(client)
    detail = assert_ok(client.get(f"/compositions/{composition['id']}"))
    source_run_id = next(
        leg["config"]["latest_run_id"]
        for leg in detail["normalized_legs"]
        if leg["leg_kind"] == "strategy"
    )

    fetched_run = assert_ok(
        client.get(f"/compositions/{composition['id']}/backtest-runs/{source_run_id}")
    )

    assert fetched_run["id"] == source_run_id
    assert fetched_run["composition_id"] == composition["id"]
    assert fetched_run["summary"]["order_count"] > 0
    assert fetched_run["summary"]["quality_label"].endswith("composition_detail_preview")

    orders = assert_ok(
        client.get(f"/compositions/{composition['id']}/backtest-runs/{source_run_id}/orders")
    )
    assert orders["total"] == fetched_run["summary"]["order_count"]
    assert orders["generated_from"] == "composition_rebalance_events_and_strategy_trades"


def test_composition_backtest_coverage_uses_actual_window_when_request_period_drifts(tmp_path):
    client, _ = create_test_client(tmp_path)
    composition = _create_sleeve_os_composition(client)
    run_id = "comp_run_requested_30y_actual_10y"
    timestamp = _iso_now()
    run_payload = {
        "id": run_id,
        "run_id": run_id,
        "composition_id": composition["id"],
        "status": "COMPLETED",
        "created_at": timestamp,
        "completed_at": timestamp,
        "request": {
            "period": "30Y",
            "horizon_years": 10,
        },
        "summary": {
            "composition_name": composition["name"],
            "horizon_years": 10.0,
            "annualized_return": 8.0,
            "sharpe": 1.1,
            "max_drawdown": 9.0,
        },
        "diagnostics": {
            "metric_matrix": [
                {"window": "10Y", "annualized_return": 8.0, "sharpe": 1.1, "max_drawdown": 9.0},
            ],
        },
    }
    client.app.state.service.storage.insert_json_row(
        "composition_backtest_runs",
        {
            "id": run_id,
            "composition_id": composition["id"],
            "status": "COMPLETED",
            "request_json": json.dumps(run_payload["request"]),
            "result_json": json.dumps(run_payload),
            "orders_json": json.dumps([]),
            "evidence_json": json.dumps({}),
            "created_at": timestamp,
            "updated_at": timestamp,
            "completed_at": timestamp,
            "deleted_at": None,
            "deleted_reason": None,
        },
    )

    listed = assert_ok(client.get("/compositions"))
    list_item = next(item for item in listed if item["id"] == composition["id"])

    assert list_item["backtest_period_coverage"][0]["period"] == "10Y"
    assert list_item["backtest_period_coverage"][0]["status"] == "covered"
    assert list_item["backtest_period_coverage"][0]["run_id"] == run_id
    assert list_item["backtest_period_coverage"][1]["period"] == "20Y"
    assert list_item["backtest_period_coverage"][1]["status"] == "missing"
    assert list_item["backtest_period_coverage"][2]["period"] == "30Y"
    assert list_item["backtest_period_coverage"][2]["status"] == "missing"


def test_global_composition_artifacts_refresh_current_status_labels(tmp_path):
    client, _ = create_test_client(tmp_path)
    composition = _create_sleeve_os_composition(client)

    created_run = assert_ok(
        client.post(
            f"/compositions/{composition['id']}/backtest-runs",
            json={"idempotency_key": "stale-global-run", "horizon_years": 10},
        )
    )
    created_job = assert_ok(
        client.post(
            f"/compositions/{composition['id']}/allocation-jobs",
            json={"idempotency_key": "stale-global-job", "intent": "min_vol"},
        )
    )

    stale_run_payload = dict(created_run)
    stale_run_payload.pop("primary_diagnosis", None)
    stale_run_payload["diagnoses"] = []
    stale_run_payload["evidence_grade"] = "C"
    stale_run_payload["return_quality_summary"] = {
        "status": "fallback",
        "aligned_points": 0,
        "missing_points": 999,
        "fallback_used": True,
    }
    client.app.state.service.storage.execute(
        "UPDATE composition_backtest_runs SET result_json = ? WHERE id = ?",
        (json.dumps(stale_run_payload), created_run["run_id"]),
    )

    stale_job_payload = dict(created_job)
    stale_job_payload.pop("primary_diagnosis", None)
    stale_job_payload["diagnoses"] = []
    stale_job_payload["evidence_grade"] = "C"
    stale_candidates = []
    for candidate in stale_job_payload["candidates"]:
        next_candidate = dict(candidate)
        if next_candidate["id"] == "min_vol":
            next_candidate["allowed_actions"] = ["promote_candidate"]
            next_candidate["promotion_readiness"] = {
                "status": "blocked",
                "evidence_grade": "C",
                "migration_cost_bps": 1.0,
                "policy_violations": [],
                "blockers": ["evidence_grade_c"],
                "required_steps": ["diff_review", "constraint_check", "migration_cost_review", "evidence_gate"],
            }
        stale_candidates.append(next_candidate)
    stale_job_payload["candidates"] = stale_candidates
    client.app.state.service.storage.execute(
        "UPDATE composition_allocation_jobs SET result_json = ? WHERE id = ?",
        (json.dumps(stale_job_payload), created_job["job_id"]),
    )

    current_list = assert_ok(client.get("/compositions"))
    current_item = next(item for item in current_list if item["id"] == composition["id"])
    current_label = current_item["primary_diagnosis"]["diagnosis_label"]
    assert current_label != "失效：异常降级补值"

    global_runs = assert_ok(client.get("/compositions/backtest-runs"))
    global_run = next(item for item in global_runs["items"] if item["run_id"] == created_run["run_id"])
    assert global_run["primary_diagnosis"]["diagnosis_label"] == current_label
    assert global_run["diagnoses"] == current_item["diagnoses"]

    fetched_run = assert_ok(
        client.get(f"/compositions/{composition['id']}/backtest-runs/{created_run['run_id']}")
    )
    assert fetched_run["primary_diagnosis"]["diagnosis_label"] == current_label

    global_jobs = assert_ok(client.get("/compositions/allocation-jobs"))
    global_job = next(item for item in global_jobs["items"] if item["job_id"] == created_job["job_id"])
    assert global_job["primary_diagnosis"]["diagnosis_label"] == current_label
    min_vol = next(item for item in global_job["candidates"] if item["id"] == "min_vol")
    assert "evidence_grade_c" not in min_vol["promotion_readiness"]["blockers"]

    fetched_job = assert_ok(
        client.get(f"/compositions/{composition['id']}/allocation-jobs/{created_job['job_id']}")
    )
    assert fetched_job["primary_diagnosis"]["diagnosis_label"] == current_label


def test_composition_allocation_job_status_and_shape(tmp_path):
    client, _ = create_test_client(tmp_path)
    composition = _create_sleeve_os_composition(client)

    created_job = assert_ok(
        client.post(
            f"/compositions/{composition['id']}/allocation-jobs",
            json={
                "idempotency_key": "allocation-001",
                "intent": "risk_parity",
                "target_volatility_pct": 8,
                "lookback_window": "10y",
            },
        )
    )

    assert created_job["composition_id"] == composition["id"]
    assert created_job["status"] == "COMPLETED"
    assert created_job["summary"]["intent"] == "risk_parity"
    assert created_job["summary"]["candidate_count"] >= 3
    assert created_job["summary"]["quality_label"] == "heuristic_from_composition_detail_preview"
    assert created_job["residual_budget"]["optimizable_weight_pct"] == pytest.approx(80.0)
    assert {item["id"] for item in created_job["candidates"]} >= {"current", "benchmark", "risk_parity", "min_vol", "max_sharpe"}
    assert created_job["summary"]["candidate_count"] == 3
    assert created_job["summary"]["reference_count"] == 2
    current_candidate = next(item for item in created_job["candidates"] if item["id"] == "current")
    benchmark_candidate = next(item for item in created_job["candidates"] if item["id"] == "benchmark")
    risk_parity_candidate = next(item for item in created_job["candidates"] if item["id"] == "risk_parity")
    min_vol_candidate = next(item for item in created_job["candidates"] if item["id"] == "min_vol")
    assert current_candidate["allowed_actions"] == []
    assert benchmark_candidate["allowed_actions"] == []
    assert min_vol_candidate["allowed_actions"] == ["promote_candidate"]
    assert "volatility" in current_candidate["metrics"]
    assert min_vol_candidate["metrics"]["max_drawdown"] < current_candidate["metrics"]["max_drawdown"]
    locked_cash_leg = next(leg for leg in composition["normalized_legs"] if leg["leg_kind"] == "cash")
    unlocked_leg_ids = [
        str(leg["id"])
        for leg in composition["normalized_legs"]
        if not leg["weight_locked"]
    ]
    risk_parity_weights = risk_parity_candidate["weights"]
    assert risk_parity_weights[locked_cash_leg["id"]] == pytest.approx(locked_cash_leg["weight_pct"])
    assert risk_parity_weights[unlocked_leg_ids[0]] < risk_parity_weights[unlocked_leg_ids[1]]
    assert risk_parity_weights[unlocked_leg_ids[0]] != pytest.approx(
        risk_parity_weights[unlocked_leg_ids[1]],
        abs=0.01,
    )
    assert "inverse realized volatility" in risk_parity_candidate["thesis"]
    assert {item["id"] for item in created_job["frontier_points"]} >= {"current", "benchmark", "risk_parity", "min_vol", "max_sharpe"}
    assert created_job["frontier_points"]
    assert created_job["covariance_preview"] == composition["correlation_matrix"]
    assert created_job["evidence"]["not_real_optimizer"] is True
    assert created_job["evidence_grade"] in {"A", "B", "C"}
    assert created_job["scenario_anchors"]
    assert created_job["risk_budget_timeline"]
    assert min_vol_candidate["promotion_readiness"]["required_steps"] == [
        "diff_review",
        "constraint_check",
        "migration_cost_review",
        "evidence_gate",
    ]

    fetched_job = assert_ok(
        client.get(f"/compositions/{composition['id']}/allocation-jobs/{created_job['job_id']}")
    )
    assert fetched_job["job_id"] == created_job["job_id"]
    assert {item["id"] for item in fetched_job["candidates"]} == {
        item["id"] for item in created_job["candidates"]
    }
    assert fetched_job["primary_diagnosis"]["diagnosis_label"]
    fetched_min_vol = next(item for item in fetched_job["candidates"] if item["id"] == "min_vol")
    assert (
        fetched_min_vol["promotion_readiness"]["primary_diagnosis"]["diagnosis_label"]
        == fetched_job["primary_diagnosis"]["diagnosis_label"]
    )

    global_jobs = assert_ok(client.get("/compositions/allocation-jobs"))
    assert any(item["job_id"] == created_job["job_id"] for item in global_jobs["items"])


def test_composition_allocation_job_ignores_stale_evidence_grade_block_when_current_status_allows(tmp_path):
    client, _ = create_test_client(tmp_path)
    composition = _create_sleeve_os_composition(client)
    created_job = assert_ok(
        client.post(
            f"/compositions/{composition['id']}/allocation-jobs",
            json={"idempotency_key": "blocked-evidence-allocation", "intent": "min_vol"},
        )
    )
    blocked_payload = dict(created_job)
    blocked_payload["candidates"] = [
        {
            **candidate,
            "allowed_actions": ["promote_candidate"],
            "promotion_readiness": {
                "status": "blocked",
                "evidence_grade": "C",
                "migration_cost_bps": 1.0,
                "policy_violations": [],
                "blockers": ["evidence_grade_c"],
                "required_steps": ["diff_review", "constraint_check", "migration_cost_review", "evidence_gate"],
            },
        }
        if candidate["id"] == "min_vol"
        else candidate
        for candidate in created_job["candidates"]
    ]
    client.app.state.service.storage.execute(
        "UPDATE composition_allocation_jobs SET result_json = ? WHERE id = ?",
        (json.dumps(blocked_payload), created_job["job_id"]),
    )

    fetched_job = assert_ok(
        client.get(f"/compositions/{composition['id']}/allocation-jobs/{created_job['job_id']}")
    )
    min_vol_candidate = next(item for item in fetched_job["candidates"] if item["id"] == "min_vol")
    assert min_vol_candidate["promotion_readiness"]["status"] == "ready"
    assert "evidence_grade_c" not in min_vol_candidate["promotion_readiness"]["blockers"]
    assert "promote_candidate" in min_vol_candidate["allowed_actions"]


def test_composition_v2_versions_promotion_and_decision_packet_are_snapshots(tmp_path):
    client, _ = create_test_client(tmp_path)
    composition = _create_sleeve_os_composition(client)

    created_run = assert_ok(
        client.post(
            f"/compositions/{composition['id']}/backtest-runs",
            json={"idempotency_key": "v2-run", "horizon_years": 10},
        )
    )
    created_job = assert_ok(
        client.post(
            f"/compositions/{composition['id']}/allocation-jobs",
            json={"idempotency_key": "v2-allocation", "intent": "risk_parity"},
        )
    )

    versions_before = assert_ok(client.get(f"/compositions/{composition['id']}/versions"))
    assert any(item["status"] == "ACTIVE" for item in versions_before["items"])

    candidate = next(item for item in created_job["candidates"] if item["id"] == "risk_parity")
    draft = assert_ok(
        client.post(
            f"/compositions/{composition['id']}/allocation-jobs/{created_job['job_id']}/candidates/{candidate['id']}/promote-draft",
            json={"decision_note": "Review candidate as draft only."},
        )
    )
    assert draft["status"] == "DRAFT"
    assert draft["source_kind"] == "allocation_candidate"
    assert draft["diff"]["weight_changes"]
    assert draft["evidence"]["required_steps"] == [
        "diff_review",
        "constraint_check",
        "migration_cost_review",
        "evidence_gate",
    ]

    blocked = client.post(
        f"/compositions/{composition['id']}/allocation-jobs/{created_job['job_id']}/candidates/current/promote-draft",
        json={"decision_note": "Reference rows cannot promote."},
    )
    assert blocked.status_code == 400

    packet = assert_ok(
        client.post(
            f"/compositions/{composition['id']}/decision-packets",
            json={
                "version_id": draft["id"],
                "backtest_run_id": created_run["run_id"],
                "allocation_job_id": created_job["job_id"],
                "candidate_id": candidate["id"],
                "recommendation": "committee_review",
                "notes": "Snapshot should not drift after current composition changes.",
            },
        )
    )
    assert packet["version_id"] == draft["id"]
    assert packet["source_refs"]["candidate_id"] == candidate["id"]
    assert packet["packet"]["snapshot"]["version"]["id"] == draft["id"]
    original_packet_snapshot = packet["packet"]

    assert_ok(client.patch(f"/compositions/{composition['id']}", json={"status": "DRAFT"}))
    fetched_packet = assert_ok(
        client.get(f"/compositions/{composition['id']}/decision-packets/{packet['id']}")
    )
    assert fetched_packet["packet"] == original_packet_snapshot

    markdown_response = client.get(
        f"/compositions/{composition['id']}/decision-packets/{packet['id']}/export?format=markdown"
    )
    assert markdown_response.status_code == 200, markdown_response.text
    assert markdown_response.headers["content-type"].startswith("text/markdown")
    assert draft["id"] in markdown_response.text

    html_response = client.get(
        f"/compositions/{composition['id']}/decision-packets/{packet['id']}/export?format=html"
    )
    assert html_response.status_code == 200, html_response.text
    assert html_response.headers["content-type"].startswith("text/html")
    assert "<!doctype html>" in html_response.text.lower()


def test_composition_update_skips_noop_versions_and_requires_upgrade_reason(tmp_path):
    client, _ = create_test_client(tmp_path)
    composition = _create_sleeve_os_composition(client)
    composition_id = composition["id"]
    before_detail = assert_ok(client.get(f"/compositions/{composition_id}"))
    before_freeze_count = _table_count(client, "composition_source_freezes")
    before_audit_count = _table_count(client, "composition_audit_events")
    before_revision = before_detail["source_evidence"][0]["snapshot"]["revision"]

    unchanged_payload = {
        "name": before_detail["name"],
        "description": before_detail["description"],
        "status": before_detail["status"],
        "benchmark_definition": before_detail["benchmark_definition"],
        "rebalance_frequency": before_detail["rebalance_frequency"],
        "cost_policy": before_detail["cost_policy"],
        "legs": _composition_update_legs(before_detail),
    }
    unchanged = assert_ok(client.patch(f"/compositions/{composition_id}", json=unchanged_payload))

    assert unchanged["updated_at"] == before_detail["updated_at"]
    assert unchanged["source_evidence"][0]["snapshot"]["revision"] == before_revision
    assert _table_count(client, "composition_source_freezes") == before_freeze_count
    assert _table_count(client, "composition_audit_events") == before_audit_count

    changed_legs = _composition_update_legs(before_detail)
    changed_legs[0]["weight_pct"] = changed_legs[0]["weight_pct"] - 5
    changed_legs[1]["weight_pct"] = changed_legs[1]["weight_pct"] + 5
    missing_reason = client.patch(
        f"/compositions/{composition_id}",
        json={**unchanged_payload, "legs": changed_legs},
    )

    assert missing_reason.status_code == 400
    assert missing_reason.json()["code"] == "bad_request"
    assert "version_reason" in missing_reason.json()["message"]
    assert _table_count(client, "composition_source_freezes") == before_freeze_count
    assert _table_count(client, "composition_audit_events") == before_audit_count

    updated = assert_ok(
        client.patch(
            f"/compositions/{composition_id}",
            json={
                **unchanged_payload,
                "legs": changed_legs,
                "version_reason": "Reduce strategy sleeve concentration after allocation review.",
                "version_change_summary": "Strategy sleeve -5pt; asset ballast +5pt.",
                "version_source": "manual_save",
            },
        )
    )

    assert updated["source_evidence"][0]["snapshot"]["revision"] == before_revision + 1
    assert _table_count(client, "composition_source_freezes") == before_freeze_count + len(changed_legs)
    assert _table_count(client, "composition_audit_events") == before_audit_count + 4
    structure_event = updated["audit_trail"][-4]
    assert structure_event["action"] == "structure_patch"
    assert structure_event["reason"] == "Reduce strategy sleeve concentration after allocation review."
    assert structure_event["change_summary"] == "Strategy sleeve -5pt; asset ballast +5pt."
    assert structure_event["version_source"] == "manual_save"
    assert structure_event["version_before"] == before_revision
    assert structure_event["version_after"] == before_revision + 1


def test_composition_detail_and_list_flag_saved_strategy_leg_new_version(tmp_path):
    client, _ = create_test_client(tmp_path)
    asset_leg, cash_leg = _create_seed_legs(client)
    created = create_momentum_strategy(client, idempotency_key="composition-version-drift-base")
    strategy = created["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    _seed_completed_run(client, strategy["id"], base_parameter_version_id)
    stale_strategy_leg_ref = f"strategy_leg::{strategy['id']}::{base_parameter_version_id}"

    composition = assert_ok(
        client.post(
            "/compositions",
            json={
                "name": "Version Drift Overlay",
                "description": "Composition keeps a frozen strategy leg while a newer parameter version exists.",
                "benchmark_definition": {"label": "S&P 500", "symbol": "SPY"},
                "rebalance_frequency": "quarterly",
                "legs": [
                    {
                        "leg_kind": "strategy",
                        "source_ref_id": stale_strategy_leg_ref,
                        "weight_pct": 50,
                        "weight_locked": False,
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
                "status": "ACTIVE",
            },
        )
    )

    revised = create_momentum_strategy(
        client,
        mode="REVISION",
        base_strategy_id=strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
        top_n=2,
        idempotency_key="composition-version-drift-current",
    )["strategy"]
    current_parameter_version_id = revised["current_parameter_version_id"]
    assert current_parameter_version_id != base_parameter_version_id
    current_run_id = _seed_completed_run(client, strategy["id"], current_parameter_version_id)

    detail = assert_ok(client.get(f"/compositions/{composition['id']}"))
    strategy_integrity = next(
        item for item in detail["source_integrity"] if item["source_ref_id"] == stale_strategy_leg_ref
    )
    assert strategy_integrity["drift_status"] == "drifted"
    assert strategy_integrity["signature_status"] == "stale"
    assert (
        strategy_integrity["current_ref_id"]
        == f"strategy_leg::{current_parameter_version_id}::{current_run_id}"
    )
    assert any("newer parameter version exists" in alert for alert in strategy_integrity["alerts"])

    listed = assert_ok(client.get("/compositions"))
    list_item = next(item for item in listed if item["id"] == composition["id"])
    assert list_item["has_new_version"] is True
    assert any(item["source_ref_id"] == stale_strategy_leg_ref for item in list_item["source_integrity"])


def test_composition_detail_and_list_keep_frozen_same_version_strategy_run_source(tmp_path):
    client, _ = create_test_client(tmp_path)
    asset_leg, cash_leg = _create_seed_legs(client)
    created = create_momentum_strategy(client, idempotency_key="composition-run-drift-base")
    strategy = created["strategy"]
    parameter_version_id = strategy["current_parameter_version_id"]
    first_run_id = _seed_completed_run_with_monthly_series(
        client,
        strategy["id"],
        parameter_version_id,
        monthly_return=0.02,
        annualized_return=0.27,
        sharpe=1.85,
        completed_at="2026-05-01T09:00:00Z",
    )
    strategy_leg_ref = f"strategy_leg::{parameter_version_id}::{first_run_id}"
    payload = {
        "name": "Same Version Run Drift Overlay",
        "description": "Composition should keep the frozen run when the same parameter version gets a newer run.",
        "benchmark_definition": {"label": "S&P 500", "symbol": "SPY"},
        "rebalance_frequency": "quarterly",
        "legs": [
            {
                "leg_kind": "strategy",
                "source_ref_id": strategy_leg_ref,
                "weight_pct": 80,
                "weight_locked": False,
                "ordering": 1,
            },
            {
                "leg_kind": "asset",
                "source_ref_id": asset_leg["id"],
                "weight_pct": 10,
                "weight_locked": False,
                "ordering": 2,
            },
            {
                "leg_kind": "cash",
                "source_ref_id": cash_leg["id"],
                "weight_pct": 10,
                "weight_locked": False,
                "ordering": 3,
            },
        ],
        "status": "ACTIVE",
    }

    composition = assert_ok(client.post("/compositions", json=payload))
    first_return = next(item["value"] for item in composition["kpis"] if item["key"] == "annualized_return")
    first_strategy_leg = next(item for item in composition["normalized_legs"] if item["source_ref_id"] == strategy_leg_ref)
    assert first_strategy_leg["config"]["latest_run_id"] == first_run_id

    second_run_id = _seed_completed_run_with_monthly_series(
        client,
        strategy["id"],
        parameter_version_id,
        monthly_return=-0.006,
        annualized_return=-0.04,
        sharpe=-0.15,
        completed_at="2026-05-02T09:00:00Z",
    )

    detail = assert_ok(client.get(f"/compositions/{composition['id']}"))
    frozen_strategy_leg = next(item for item in detail["normalized_legs"] if item["source_ref_id"] == strategy_leg_ref)
    frozen_return = next(item["value"] for item in detail["kpis"] if item["key"] == "annualized_return")
    strategy_integrity = next(item for item in detail["source_integrity"] if item["source_ref_id"] == strategy_leg_ref)
    strategy_quality = next(
        item
        for item in detail["return_quality_summary"]["leg_quality"]
        if item["source_ref_id"] == strategy_leg_ref
    )

    assert second_run_id != first_run_id
    assert frozen_strategy_leg["config"]["latest_run_id"] == first_run_id
    assert frozen_return == pytest.approx(first_return, abs=0.001)
    assert strategy_integrity["current_ref_id"] == f"strategy_leg::{parameter_version_id}::{second_run_id}"
    assert strategy_integrity["has_new_parameters"] is True
    assert strategy_integrity["drift_status"] == "drifted"
    assert strategy_integrity["signature_status"] == "stale"
    assert any("same strategy version and backtest period" in alert for alert in strategy_integrity["alerts"])
    assert detail["return_quality_summary"]["metric_basis"] == "aligned_recent_window"
    assert detail["return_quality_summary"]["metric_window_label"]
    assert strategy_quality["source_run_id"] == first_run_id
    assert strategy_quality["source_metric_basis"] == "frozen_run_full_window"
    assert strategy_quality["source_annualized_return_pct"] == pytest.approx(27.0, abs=0.001)
    assert strategy_quality["aligned_annualized_return_pct"] is not None
    assert detail["primary_diagnosis"]["diagnosis_type"] == "strategy_leg_new_parameters"
    assert detail["primary_diagnosis"]["diagnosis_label"] == "待校准：腿有新参数"

    listed = assert_ok(client.get("/compositions"))
    list_item = next(item for item in listed if item["id"] == composition["id"])
    list_strategy_integrity = next(
        item for item in list_item["source_integrity"] if item["source_ref_id"] == strategy_leg_ref
    )
    assert list_strategy_integrity["current_ref_id"] == f"strategy_leg::{parameter_version_id}::{second_run_id}"
    assert list_strategy_integrity["has_new_parameters"] is True
    assert list_item["has_new_version"] is False
    assert list_item["annualized_return"] == pytest.approx(frozen_return, abs=0.001)
    assert list_item["return_quality_summary"]["metric_basis"] == "aligned_recent_window"
    assert list_item["primary_diagnosis"]["diagnosis_label"] == "待校准：腿有新参数"
    assert list_item["primary_diagnosis"]["actions"][0]["label"] == "查看对应腿"
    assert list_item["primary_diagnosis"]["actions"][0]["route"] == (
        f"/legs?source_ref_id=strategy_leg%3A%3A{parameter_version_id}%3A%3A{first_run_id}"
    )
    assert list_item["sharpe"] == pytest.approx(
        next(item["value"] for item in detail["kpis"] if item["key"] == "sharpe"),
        abs=0.001,
    )


def test_source_signature_stale_does_not_flag_strategy_version_update(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    source_ref_id = "strategy_leg::strat_123::strat_123-v2"

    assert (
        service._composition_source_integrity_has_new_strategy_version(
            {
                "source_ref_id": source_ref_id,
                "current_ref_id": source_ref_id,
                "signature_status": "stale",
                "drift_status": "drifted",
                "alerts": ["Current source version differs from the frozen source signature."],
            }
        )
        is False
    )

    assert (
        service._composition_source_integrity_has_new_strategy_version(
            {
                "source_ref_id": source_ref_id,
                "current_ref_id": "strategy_leg::strat_123::strat_123-v3",
                "signature_status": "stale",
                "drift_status": "version_drift",
                "alerts": ["A newer parameter version exists for this strategy leg."],
            }
        )
        is True
    )


def test_list_compositions_uses_lightweight_summary_without_detail_fanout(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    composition = _create_sleeve_os_composition(client)
    service = client.app.state.service
    detail_calls: list[str] = []
    projection_fallback_calls: list[str] = []
    original_get_detail = service.get_composition_detail
    original_strategy_projection = service._strategy_projection_row_for_source_ref

    def counted_get_detail(composition_id: str):
        detail_calls.append(composition_id)
        return original_get_detail(composition_id)

    def counted_strategy_projection(source_ref_id: str):
        projection_fallback_calls.append(source_ref_id)
        return original_strategy_projection(source_ref_id)

    monkeypatch.setattr(service, "get_composition_detail", counted_get_detail)
    monkeypatch.setattr(service, "_strategy_projection_row_for_source_ref", counted_strategy_projection)

    listed = assert_ok(client.get("/compositions"))
    list_item = next(item for item in listed if item["id"] == composition["id"])

    assert list_item["source_integrity"]
    assert detail_calls == []
    assert projection_fallback_calls == []


def test_composition_detail_treats_tips_curve_source_as_managed_profile_stream(tmp_path):
    client, _ = create_test_client(tmp_path)
    created = create_momentum_strategy(client, idempotency_key="composition-tips-curve-source")
    strategy = created["strategy"]
    _seed_completed_run_with_monthly_series(
        client,
        strategy["id"],
        strategy["current_parameter_version_id"],
        month_count=121,
        start_year=2016,
        start_month=3,
    )
    tips_ref = _seed_tips_curve_snapshot(client, snapshot_date="2026-04-23", real_yield_pct=1.92)
    _seed_tips_curve_snapshot(client, snapshot_date="2026-05-01", real_yield_pct=1.91)
    tips_leg = assert_ok(
        client.post(
            "/asset-legs",
            json={
                "name": "美国10年通胀保值债",
                "symbol": "TIPS10Y",
                "asset_kind": "BOND",
                "source_snapshot_id": tips_ref,
                "source_provider": "bond_fixed_income",
                "freeze_mode": "snapshot_locked",
            },
        )
    )
    _, cash_leg = _create_seed_legs(client)
    strategy_leg_ref = f"strategy_leg::{strategy['id']}::{strategy['current_parameter_version_id']}"
    payload = {
        "name": "TIPS Curve Managed Profile Regression",
        "benchmark_definition": {"label": "S&P 500", "symbol": "SPY"},
        "rebalance_frequency": "quarterly",
        "legs": [
            {"leg_kind": "strategy", "source_ref_id": strategy_leg_ref, "weight_pct": 50, "ordering": 1},
            {"leg_kind": "asset", "source_ref_id": tips_leg["id"], "weight_pct": 20, "ordering": 2},
            {"leg_kind": "cash", "source_ref_id": cash_leg["id"], "weight_pct": 30, "ordering": 3},
        ],
    }

    preview = assert_ok(client.post("/compositions/preview", json=payload))

    quality = preview["return_quality_summary"]
    assert quality["alignment_window_start"] == "2016-04"
    assert quality["alignment_window_end"] == "2026-03"
    assert quality["missing_points"] == 0
    assert quality["fallback_used"] is False
    strategy_quality = next(item for item in quality["leg_quality"] if item["leg_kind"] == "strategy")
    assert strategy_quality["sample_points"] == 121
    assert strategy_quality["aligned_points"] == 120
    assert strategy_quality["missing_points"] == 0
    assert strategy_quality["issue_types"] == []
    tips_quality = next(item for item in quality["leg_quality"] if item["leg_id"] == tips_leg["id"])
    assert tips_quality["sample_points"] == 120
    assert tips_quality["aligned_points"] == 120
    assert tips_quality["missing_points"] == 0
    assert tips_quality["issue_types"] == []
    assert any("managed return-profile" in note.lower() for note in quality["notes"])


def test_composition_detail_managed_profile_applies_to_all_fixed_income_and_cash_legs(tmp_path):
    client, _ = create_test_client(tmp_path)
    created = create_momentum_strategy(client, idempotency_key="composition-all-fi-cash-managed-source")
    strategy = created["strategy"]
    _seed_completed_run_with_monthly_series(
        client,
        strategy["id"],
        strategy["current_parameter_version_id"],
        month_count=121,
        start_year=2016,
        start_month=3,
    )
    ust_cmt_ref = _seed_ust_cmt_curve_snapshot(client, snapshot_date="2026-04-23", ytm_pct=4.28)
    _seed_ust_cmt_curve_snapshot(client, snapshot_date="2026-05-01", ytm_pct=4.26)
    tips_ref = _seed_tips_curve_snapshot(client, snapshot_date="2026-04-23", real_yield_pct=1.92)
    _seed_tips_curve_snapshot(client, snapshot_date="2026-05-01", real_yield_pct=1.91)
    tbill_ref = _seed_tbill_snapshot(client)
    lqd_ref = _seed_lqd_official_snapshot(client)

    ust_cmt_leg = assert_ok(
        client.post(
            "/asset-legs",
            json={
                "name": "UST 10Y CMT Managed Leg",
                "symbol": "UST10Y",
                "asset_kind": "BOND",
                "source_snapshot_id": ust_cmt_ref,
                "source_provider": "bond_fixed_income",
                "freeze_mode": "snapshot_locked",
            },
        )
    )
    tips_leg = assert_ok(
        client.post(
            "/asset-legs",
            json={
                "name": "TIPS 10Y Managed Leg",
                "symbol": "TIPS10Y",
                "asset_kind": "BOND",
                "source_snapshot_id": tips_ref,
                "source_provider": "bond_fixed_income",
                "freeze_mode": "snapshot_locked",
            },
        )
    )
    tbill_leg = assert_ok(
        client.post(
            "/asset-legs",
            json={
                "name": "T-Bill Managed Leg",
                "symbol": "TBILL13W",
                "asset_kind": "BOND",
                "source_snapshot_id": tbill_ref,
                "source_provider": "bond_fixed_income",
                "freeze_mode": "snapshot_locked",
            },
        )
    )
    lqd_leg = assert_ok(
        client.post(
            "/asset-legs",
            json={
                "name": "LQD Managed Leg",
                "symbol": "LQD",
                "asset_kind": "BOND_ETF",
                "source_snapshot_id": lqd_ref,
                "source_provider": "bond_fixed_income",
                "freeze_mode": "snapshot_locked",
            },
        )
    )
    _, cash_leg = _create_seed_legs(client)
    strategy_leg_ref = f"strategy_leg::{strategy['id']}::{strategy['current_parameter_version_id']}"
    managed_leg_ids = {ust_cmt_leg["id"], tips_leg["id"], tbill_leg["id"], lqd_leg["id"], cash_leg["id"]}
    payload = {
        "name": "All Fixed Income Managed Profile Regression",
        "benchmark_definition": {"label": "S&P 500", "symbol": "SPY"},
        "rebalance_frequency": "quarterly",
        "legs": [
            {"leg_kind": "strategy", "source_ref_id": strategy_leg_ref, "weight_pct": 40, "ordering": 1},
            {"leg_kind": "asset", "source_ref_id": ust_cmt_leg["id"], "weight_pct": 15, "ordering": 2},
            {"leg_kind": "asset", "source_ref_id": tips_leg["id"], "weight_pct": 15, "ordering": 3},
            {"leg_kind": "asset", "source_ref_id": tbill_leg["id"], "weight_pct": 10, "ordering": 4},
            {"leg_kind": "asset", "source_ref_id": lqd_leg["id"], "weight_pct": 10, "ordering": 5},
            {"leg_kind": "cash", "source_ref_id": cash_leg["id"], "weight_pct": 10, "ordering": 6},
        ],
    }

    preview = assert_ok(client.post("/compositions/preview", json=payload))

    quality = preview["return_quality_summary"]
    assert quality["alignment_window_start"] == "2016-04"
    assert quality["alignment_window_end"] == "2026-03"
    assert quality["aligned_points"] == 120
    assert quality["missing_points"] == 0
    assert quality["fallback_used"] is False
    quality_by_leg_id = {item["leg_id"]: item for item in quality["leg_quality"]}
    for leg_id in managed_leg_ids:
        row = quality_by_leg_id[leg_id]
        assert row["sample_points"] == 120
        assert row["aligned_points"] == 120
        assert row["missing_points"] == 0
        assert row["issue_types"] == []
    strategy_quality = next(item for item in quality["leg_quality"] if item["leg_kind"] == "strategy")
    assert strategy_quality["sample_points"] == 121
    assert strategy_quality["aligned_points"] == 120
    assert strategy_quality["missing_points"] == 0
    assert strategy_quality["issue_types"] == []
    assert any("managed return-profile" in note.lower() for note in quality["notes"])


def test_composition_detail_recomputes_legacy_problem_leg_quality_for_resolved_proxy(tmp_path):
    client, _ = create_test_client(tmp_path)
    momentum = create_momentum_strategy(client, idempotency_key="composition-legacy-proxy-momentum")
    momentum_strategy = momentum["strategy"]
    _seed_completed_run_with_monthly_series(
        client,
        momentum_strategy["id"],
        momentum_strategy["current_parameter_version_id"],
        month_count=121,
        start_year=2016,
        start_month=3,
    )
    grid = create_grid_strategy(client, idempotency_key="composition-legacy-proxy-grid")
    grid_strategy = grid["strategy"]
    _seed_completed_run_with_monthly_series(
        client,
        grid_strategy["id"],
        grid_strategy["current_parameter_version_id"],
        month_count=325,
        start_year=1999,
        start_month=3,
    )
    ust_cmt_ref = _seed_ust_cmt_curve_snapshot(client, snapshot_date="2026-04-23", ytm_pct=4.28)
    _seed_ust_cmt_curve_snapshot(client, snapshot_date="2026-05-01", ytm_pct=4.26)
    asset_leg = assert_ok(
        client.post(
            "/asset-legs",
            json={
                "name": "美国10年国债",
                "symbol": "UST10Y",
                "asset_kind": "BOND",
                "source_snapshot_id": ust_cmt_ref,
                "source_provider": "bond_fixed_income",
                "freeze_mode": "snapshot_locked",
            },
        )
    )
    cash_leg = assert_ok(
        client.post(
            "/cash-legs",
            json={
                "name": "现金安全垫",
                "cash_rule_kind": "BOXX",
                "buffer_bps": 12,
                "yield_source": "BOXX",
                "freeze_mode": "manual",
            },
        )
    )
    momentum_ref = f"strategy_leg::{momentum_strategy['id']}::{momentum_strategy['current_parameter_version_id']}"
    grid_ref = f"strategy_leg::{grid_strategy['id']}::{grid_strategy['current_parameter_version_id']}"
    payload = {
        "name": "QQQ网格&标普动量平衡",
        "benchmark_definition": {"label": "基准组合(70/30)", "symbol": "QQQ"},
        "rebalance_frequency": "quarterly",
        "legs": [
            {"leg_kind": "strategy", "source_ref_id": momentum_ref, "weight_pct": 30, "ordering": 1},
            {"leg_kind": "strategy", "source_ref_id": grid_ref, "weight_pct": 40, "ordering": 2},
            {"leg_kind": "cash", "source_ref_id": cash_leg["id"], "weight_pct": 5, "ordering": 3},
            {"leg_kind": "asset", "source_ref_id": asset_leg["id"], "weight_pct": 25, "ordering": 4},
        ],
    }
    created = assert_ok(client.post("/compositions", json={**payload, "status": "ACTIVE"}))
    stale_payload = dict(created)
    stale_payload["return_quality_summary"] = {
        "status": "limited",
        "alignment_window_start": "2016-06",
        "alignment_window_end": "2026-05",
        "aligned_points": 120,
        "missing_points": 242,
        "coverage_pct": 49.58,
        "fallback_used": True,
        "notes": ["Legacy system-proxy payload kept actionable leg gaps after the proxy was resolved."],
        "leg_quality": [
            {
                "leg_id": momentum_ref,
                "display_name": "标普动量策略",
                "leg_kind": "strategy",
                "source_ref_id": momentum_ref,
                "sample_points": 121,
                "aligned_points": 118,
                "missing_points": 2,
                "coverage_pct": 98.33,
                "window_start": "2016-03",
                "window_end": "2026-03",
                "issue_types": ["对齐缺口"],
            },
            {
                "leg_id": grid_ref,
                "display_name": "QQQ 网格交易策略",
                "leg_kind": "strategy",
                "source_ref_id": grid_ref,
                "sample_points": 325,
                "aligned_points": 118,
                "missing_points": 2,
                "coverage_pct": 98.33,
                "window_start": "1999-03",
                "window_end": "2026-03",
                "issue_types": ["对齐缺口"],
            },
            {
                "leg_id": cash_leg["id"],
                "display_name": "现金安全垫",
                "leg_kind": "cash",
                "source_ref_id": cash_leg["id"],
                "sample_points": 0,
                "aligned_points": 0,
                "missing_points": 120,
                "coverage_pct": 0.0,
                "window_start": None,
                "window_end": None,
                "issue_types": ["收益样本缺失", "对齐缺口"],
            },
            {
                "leg_id": asset_leg["id"],
                "display_name": "美国10年国债",
                "leg_kind": "asset",
                "source_ref_id": asset_leg["id"],
                "sample_points": 2,
                "aligned_points": 2,
                "missing_points": 118,
                "coverage_pct": 1.67,
                "window_start": "2026-04",
                "window_end": "2026-05",
                "issue_types": ["收益样本不足", "对齐缺口"],
            },
        ],
    }
    client.app.state.service.storage.execute(
        "UPDATE compositions SET analysis_json = ? WHERE id = ?",
        (json.dumps(stale_payload), created["id"]),
    )

    fetched = assert_ok(client.get(f"/compositions/{created['id']}"))
    quality = fetched["return_quality_summary"]
    assert quality["aligned_points"] == 120
    assert quality["missing_points"] == 0
    assert quality["fallback_used"] is False
    assert quality["alignment_window_end"] == "2026-03"
    assert all(item["missing_points"] == 0 for item in quality["leg_quality"])
    assert all(item["issue_types"] == [] for item in quality["leg_quality"])
    assert fetched["primary_diagnosis"]["diagnosis_label"] == "稳健：系统代理覆盖"
    debug_quality = fetched["primary_diagnosis"]["debug_facts"]["leg_quality"]
    assert all(item["issue_types"] == [] for item in debug_quality)

    listed = assert_ok(client.get("/compositions"))
    list_item = next(item for item in listed if item["id"] == created["id"])
    assert list_item["primary_diagnosis"]["diagnosis_label"] == fetched["primary_diagnosis"]["diagnosis_label"]
    assert all(
        item["issue_types"] == []
        for item in list_item["primary_diagnosis"]["debug_facts"]["leg_quality"]
    )


def test_composition_detail_defaults_to_recent_ten_year_window_and_fills_missing_leg_streams(tmp_path):
    client, _ = create_test_client(tmp_path)
    created = create_momentum_strategy(client, idempotency_key="composition-ten-year-window")
    strategy = created["strategy"]
    _seed_completed_run_with_monthly_series(
        client,
        strategy["id"],
        strategy["current_parameter_version_id"],
        month_count=150,
    )
    asset_leg, cash_leg = _create_seed_legs(client)
    strategy_leg_ref = f"strategy_leg::{strategy['id']}::{strategy['current_parameter_version_id']}"
    payload = {
        "name": "Ten Year Overlay",
        "description": "Recent window and missing-leg fallback regression",
        "benchmark_definition": {"label": "S&P 500", "symbol": "SPY"},
        "rebalance_frequency": "quarterly",
        "legs": [
            {
                "leg_kind": "strategy",
                "source_ref_id": strategy_leg_ref,
                "weight_pct": 50,
                "weight_locked": False,
                "ordering": 1,
            },
            {
                "leg_kind": "asset",
                "source_ref_id": asset_leg["id"],
                "weight_pct": 20,
                "weight_locked": False,
                "ordering": 2,
            },
            {
                "leg_kind": "cash",
                "source_ref_id": cash_leg["id"],
                "weight_pct": 30,
                "weight_locked": False,
                "ordering": 3,
            },
        ],
    }

    preview = assert_ok(client.post("/compositions/preview", json=payload))

    assert len(preview["returns_preview"]) == 120
    assert preview["returns_preview"][0]["label"] == "2015-07"
    assert preview["returns_preview"][-1]["label"] == "2025-06"
    assert preview["return_quality_summary"]["aligned_points"] == 120
    assert preview["return_quality_summary"]["fallback_used"] is True
    assert preview["return_quality_summary"]["missing_points"] >= 120
    leg_quality = preview["return_quality_summary"]["leg_quality"]
    assert any(item["sample_points"] >= 120 and item["missing_points"] == 0 for item in leg_quality)
    assert any("对齐缺口" in item["issue_types"] and item["missing_points"] >= 120 for item in leg_quality)
    cash_quality = next(item for item in leg_quality if item["leg_kind"] == "cash")
    assert cash_quality["issue_types"] == []
    assert cash_quality["missing_points"] == 0
    assert preview["primary_diagnosis"]["diagnosis_label"] == "待校准：代理覆盖待确认"
    assert preview["primary_diagnosis"]["proxy_context"][0]["proxy_source"] == "unconfirmed"
    assert len(preview["rebalance_events"]) == 41
    assert preview["rebalance_events"][0]["label"] == "2015-07"
    assert preview["rebalance_events"][-1]["label"] == "2025-06"

    created_composition = assert_ok(client.post("/compositions", json={**payload, "status": "ACTIVE"}))
    assert created_composition["primary_diagnosis"]["diagnosis_label"] == "待校准：代理覆盖待确认"
    created_run = assert_ok(
        client.post(
            f"/compositions/{created_composition['id']}/backtest-runs",
            json={"idempotency_key": "ten-year-overlay-regression", "horizon_years": 10},
        )
    )
    assert created_run["summary"]["rebalance_event_count"] == 41
    assert created_run["summary"]["order_count"] >= 120
    orders = assert_ok(
        client.get(
            f"/compositions/{created_composition['id']}/backtest-runs/{created_run['run_id']}/orders?page_size=500"
        )
    )
    assert orders["total"] == created_run["summary"]["order_count"]
    assert orders["items"][0]["event_label"] == "2015-07"
    assert orders["items"][-1]["event_label"] == "2025-06"
    proxy_context = created_composition["primary_diagnosis"]["proxy_context"][0]
    confirmed = assert_ok(
        client.post(
            f"/compositions/{created_composition['id']}/proxy-confirmations",
            json={
                "leg_id": proxy_context["leg_id"],
                "target_symbol": proxy_context["target_symbol"],
                "proxy_symbol": proxy_context["proxy_symbol"],
                "horizon_label": proxy_context["horizon_label"],
                "proxy_signature": proxy_context["proxy_signature"],
                "coverage_window": proxy_context["coverage_window"],
                "reason": "Regression confirms planned proxy coverage.",
            },
        )
    )
    assert confirmed["primary_diagnosis"]["diagnosis_label"] == "稳健：人工确认代理覆盖"
    refreshed = assert_ok(client.post(f"/compositions/{created_composition['id']}/diagnostics/refresh"))
    assert refreshed["primary_diagnosis"]["diagnosis_label"] == "稳健：人工确认代理覆盖"
    listed = assert_ok(client.get("/compositions"))
    list_item = next(item for item in listed if item["id"] == created_composition["id"])
    assert any(item["diagnosis_label"] == "稳健：人工确认代理覆盖" for item in list_item["diagnoses"])
    assert all(item["diagnosis_label"] != "待校准：代理覆盖待确认" for item in list_item["diagnoses"])
    initial_annualized_return = next(
        item["value"] for item in created_composition["kpis"] if item["key"] == "annualized_return"
    )
    updated = assert_ok(
        client.patch(
            f"/compositions/{created_composition['id']}",
            json={
                **payload,
                "status": "ACTIVE",
                "rebalance_frequency": "monthly",
                "version_reason": "Rebalance cash buffer weight for return-window regression.",
                "version_change_summary": "Strategy sleeve +20pt; cash buffer reduced to 5pt.",
                "legs": [
                    {**payload["legs"][0], "weight_pct": 70},
                    {**payload["legs"][1], "weight_pct": 25},
                    {**payload["legs"][2], "weight_pct": 5},
                ],
            },
        )
    )

    updated_annualized_return = next(item["value"] for item in updated["kpis"] if item["key"] == "annualized_return")
    updated_cash_weight = next(item["value"] for item in updated["kpis"] if item["key"] == "cash_weight")
    assert updated_annualized_return != initial_annualized_return
    assert updated_cash_weight == 5.0
    assert len(updated["returns_preview"]) == 120
    assert updated["rebalance_frequency"] == "monthly"
    assert updated["rebalance_events"][0]["cash_buffer_pct"] == 5.0
    assert len(updated["rebalance_events"]) == 120

    stale_payload = dict(updated)
    stale_payload["kpis"] = [
        {**item, "value": initial_annualized_return}
        if item.get("key") == "annualized_return"
        else dict(item)
        for item in updated["kpis"]
    ]
    stale_payload["return_quality_summary"] = {
        "status": "verified",
        "alignment_window_start": "2015-07",
        "alignment_window_end": "2025-06",
        "aligned_points": 120,
        "missing_points": 2,
        "coverage_pct": 99.44,
        "fallback_used": False,
        "notes": [
            "Aligned 120 periods across 1 real leg streams.",
            "2 period or leg gaps were filled for quality diagnostics only.",
        ],
    }
    client.app.state.service.storage.execute(
        "UPDATE compositions SET analysis_json = ? WHERE id = ?",
        (json.dumps(stale_payload), created_composition["id"]),
    )

    fetched = assert_ok(client.get(f"/compositions/{created_composition['id']}"))
    fetched_annualized_return = next(item["value"] for item in fetched["kpis"] if item["key"] == "annualized_return")
    assert fetched_annualized_return == updated_annualized_return
    assert fetched["return_quality_summary"]["fallback_used"] is True
    assert "3 leg streams" in " ".join(fetched["return_quality_summary"]["notes"])


def test_composition_preview_does_not_synthesize_correlation_without_aligned_returns(tmp_path):
    client, _ = create_test_client(tmp_path)
    asset_leg, cash_leg = _create_seed_legs(client)
    preview = assert_ok(
        client.post(
            "/compositions/preview",
            json={
                "name": "No History Overlay",
                "rebalance_frequency": "annual",
                "legs": [
                    {
                        "leg_kind": "asset",
                        "source_ref_id": asset_leg["id"],
                        "weight_pct": 70,
                        "ordering": 1,
                    },
                    {
                        "leg_kind": "cash",
                        "source_ref_id": cash_leg["id"],
                        "weight_pct": 30,
                        "ordering": 2,
                    },
                ],
            },
        )
    )

    assert preview["return_quality_summary"]["status"] == "fallback"
    assert preview["primary_diagnosis"]["diagnosis_label"] == "失效：底层收益序列真空"
    assert preview["primary_diagnosis"]["system_disposition"] == "存在未关闭的失效问题，晋升门禁已暂停。"
    off_diagonal = [
        cell["correlation"]
        for cell in preview["correlation_matrix"]
        if cell["x_key"] != cell["y_key"]
    ]
    assert off_diagonal == [0.0, 0.0]
    assert preview["rebalance_events"][0]["turnover_pct"] == 0.0


def test_bond_snapshot_source_creates_asset_leg_and_fallback_is_rejected(tmp_path):
    client, _ = create_test_client(tmp_path)
    snapshot_ref = _seed_bond_snapshot(client)

    overview = assert_ok(client.get("/data-snapshots/overview"))
    bond = overview["bond_fixed_income"]
    assert bond["quality_audit"]
    assert bond["repair_rules"][0]["target"] == "bond"
    assert bond["daily_accrual_status"]
    assert bond["risk_budget_inputs"]
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


def test_bond_asset_leg_allows_tbill_accrued_waiver_and_rejects_lqd_watch(tmp_path):
    client, _ = create_test_client(tmp_path)
    tbill_ref = client.app.state.service.market_data_repository.upsert_bond_fixed_income_snapshot(
        {
            "id": "bond-ust-bill-13w",
            "instrument_id": "UST_BILL_3M",
            "symbol": "TBILL13W",
            "name": "UST T-Bill 13W",
            "instrument_type": "t_bill",
            "currency": "USD",
            "snapshot_date": "2026-04-23",
            "maturity_date": "2026-07-23",
            "coupon_rate_pct": 0.0,
            "clean_price": 98.75,
            "net_price": 98.75,
            "dirty_price": 98.75,
            "full_price": 98.75,
            "accrued_interest": None,
            "ytm_pct": 5.21,
            "duration": 0.24,
            "convexity": 0.01,
            "source": "bond_fixed_income",
            "refresh_status": "READY",
            "missing_fields": ["accrued_interest"],
            "inferred_fields": {},
            "raw": {
                "asset_type": "T_BILL",
                "tenor_label": "13W",
                "audit_profile": "UST_BILL_3M",
                "discount_rate_pct": 5.18,
                "effective_duration": 0.24,
            },
        }
    )
    lqd_ref = client.app.state.service.market_data_repository.upsert_bond_fixed_income_snapshot(
        {
            "id": "bond-lqd-watch",
            "instrument_id": "LQD",
            "symbol": "LQD",
            "name": "iShares iBoxx Investment Grade Corporate Bond ETF",
            "instrument_type": "etf",
            "currency": "USD",
            "snapshot_date": "2026-04-23",
            "maturity_date": None,
            "coupon_rate_pct": None,
            "clean_price": 107.15,
            "net_price": 107.15,
            "dirty_price": 107.15,
            "full_price": 107.15,
            "accrued_interest": 0.0,
            "ytm_pct": 4.88,
            "duration": 8.2,
            "convexity": 0.64,
            "source": "bond_fixed_income",
            "refresh_status": "READY",
            "missing_fields": [],
            "inferred_fields": {},
            "raw": {
                "asset_type": "BOND_ETF",
                "tenor_label": "ETF",
                "audit_profile": "LQD",
                "sec_yield_30d_pct": 4.73,
                "credit_quality": "A-",
                "tracking_error_bps": 7.5,
                "audit_notes": ["Official tracking-error evidence pending."],
            },
        }
    )

    overview = assert_ok(client.get("/data-snapshots/overview"))
    instruments = {item["id"]: item for item in overview["bond_fixed_income"]["eligible_instruments"]}
    assert instruments["bond-ust-bill-13w"]["field_status"]["accrued_interest"] == "WAIVED"
    assert instruments["bond-ust-bill-13w"]["status"] == "READY"
    assert instruments["bond-lqd-watch"]["tracking_status"] == "WATCH"
    assert instruments["bond-lqd-watch"]["field_status"]["tracking_error_bps"] == "MISSING"
    assert instruments["bond-lqd-watch"]["status"] == "WATCH"

    created = assert_ok(
        client.post(
            "/asset-legs",
            json={
                "name": "13W T-Bill Snapshot Leg",
                "symbol": "TBILL13W",
                "asset_kind": "BOND",
                "source_snapshot_id": tbill_ref,
                "source_provider": "bond_fixed_income",
                "freeze_mode": "snapshot_locked",
            },
        )
    )
    assert created["summary"]["bond_snapshot"]["asset_type"] == "T_BILL"
    assert created["summary"]["bond_snapshot"]["field_status"]["accrued_interest"] == "WAIVED"
    assert created["summary"]["bond_snapshot"]["discount_rate_pct"] == 5.18

    rejected = client.post(
        "/asset-legs",
        json={
            "name": "LQD Watch Leg",
            "symbol": "LQD",
            "asset_kind": "BOND",
            "source_snapshot_id": lqd_ref,
            "source_provider": "bond_fixed_income",
            "freeze_mode": "snapshot_locked",
        },
    )
    assert rejected.status_code == 400
    assert "not eligible" in rejected.json()["message"]


def test_bond_snapshot_refresh_appends_audit_event_without_rewriting_frozen_sources(tmp_path):
    client, _ = create_test_client(tmp_path)
    snapshot_ref = _seed_bond_snapshot(client)
    asset_leg = assert_ok(
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
    cash_leg = assert_ok(
        client.post(
            "/cash-legs",
            json={
                "name": "Cash Reserve",
                "cash_rule_kind": "TARGET_BUFFER",
                "buffer_bps": 35,
                "yield_source": "phase1_cash_proxy",
                "freeze_mode": "manual",
            },
        )
    )
    created = create_momentum_strategy(client, idempotency_key="composition-bond-refresh-impact")
    strategy = created["strategy"]
    _seed_completed_run(client, strategy["id"], strategy["current_parameter_version_id"])
    strategy_leg_ref = f"strategy_leg::{strategy['id']}::{strategy['current_parameter_version_id']}"

    composition = assert_ok(
        client.post(
            "/compositions",
            json={
                "name": "Bond Refresh Guard",
                "benchmark_definition": {"label": "S&P 500", "symbol": "SPY"},
                "rebalance_frequency": "quarterly",
                "legs": [
                    {"leg_kind": "strategy", "source_ref_id": strategy_leg_ref, "weight_pct": 50, "ordering": 1},
                    {"leg_kind": "asset", "source_ref_id": asset_leg["id"], "weight_pct": 30, "ordering": 2},
                    {"leg_kind": "cash", "source_ref_id": cash_leg["id"], "weight_pct": 20, "ordering": 3},
                ],
            },
        )
    )
    asset_risk = next(
        item for item in composition["risk_contribution_preview"] if item["leg_id"] == asset_leg["id"]
    )
    assert asset_risk["duration_contribution_years"] == pytest.approx(2.43, abs=0.001)
    assert asset_risk["convexity_contribution"] == pytest.approx(0.246, abs=0.001)
    frozen_asset = next(
        item for item in composition["source_evidence"] if item["freeze_ref_id"] == asset_leg["id"]
    )
    freeze_hash_before = frozen_asset["freeze_hash"]
    audit_count_before = _table_count(client, "composition_audit_events")

    refreshed = assert_ok(
        client.post(
            "/admin/snapshot-refresh-jobs",
            json={"reason": "bond-impact-check", "mode": "repair", "targets": ["bond"]},
        )
    )
    assert refreshed["latest_job"]["request"]["targets"] == ["bond"]
    assert _table_count(client, "composition_source_freezes") == 3
    assert _table_count(client, "composition_audit_events") == audit_count_before + 1

    detail = assert_ok(client.get(f"/compositions/{composition['id']}"))
    frozen_asset_after = next(
        item for item in detail["source_evidence"] if item["freeze_ref_id"] == asset_leg["id"]
    )
    assert frozen_asset_after["freeze_hash"] == freeze_hash_before
    assert detail["audit_trail"][-1]["action"] == "snapshot_refresh_impact_check"

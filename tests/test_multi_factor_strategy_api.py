from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta

from tests.api_test_support import (
    assert_ok,
    create_optimization_job,
    create_test_client,
    preview_backtest,
    refresh_snapshots,
    submit_backtest,
)
from tests.test_factor_research_api import seed_ready_pit_data


def _model_payload(*, neutralization_enabled: bool = False, universe: str = "SP500") -> dict:
    return {
        "name": "单元测试多因子模型",
        "universe": universe,
        "rebalance_frequency": "monthly",
        "scoring_method": "zscore_weighted",
        "components": [
            {"factor_id": "s_mom_12m1m_rank", "weight": 40, "direction": "HIGH_IS_BETTER"},
            {"factor_id": "s_val_ep_ltm_raw", "weight": 25, "direction": "HIGH_IS_BETTER"},
            {"factor_id": "s_vol_252d_rank", "weight": 20, "direction": "LOW_IS_BETTER"},
            {"factor_id": "s_size_cur_log", "weight": 15, "direction": "LOW_IS_BETTER"},
        ],
        "neutralization": {"enabled": neutralization_enabled, "method": "industry"},
    }


def _seed_direct_price_history(client) -> None:
    bars = []
    coverage = []
    start = date(2024, 1, 2)
    end = date(2024, 6, 28)
    for symbol, offset in (("AAPL", 0.0), ("MSFT", 3.0), ("NVDA", 6.0), ("AMZN", 9.0), ("SPY", 12.0)):
        trade_days = 0
        cursor = start
        price = 100.0 + offset
        while cursor <= end:
            if cursor.weekday() < 5:
                price = round(price * 1.001, 4)
                bars.append(
                    {
                        "symbol": symbol,
                        "date": cursor.isoformat(),
                        "open": price,
                        "high": round(price * 1.002, 4),
                        "low": round(price * 0.998, 4),
                        "close": price,
                        "adj_close": price,
                        "volume": 1_000_000,
                        "source": "test_seed",
                    }
                )
                trade_days += 1
            cursor += timedelta(days=1)
        coverage.append(
            {
                "symbol": symbol,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
                "trade_days": trade_days,
                "source": "test_seed",
            }
        )
    client.app.state.service.market_data_repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "测试价格快照",
            "status": "READY",
            "as_of": end.isoformat(),
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "row_count": len(bars),
            "source": "test_seed",
        },
        price_bars=bars,
        symbol_coverage=coverage,
    )


def test_factor_model_preview_returns_gate_status_and_weight_projection(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    factors = assert_ok(client.get("/factors"))
    assert {"s_val_bp_latest_raw", "s_qlty_roe_ltm_raw"}.issubset({item["id"] for item in factors["items"]})

    ready = assert_ok(client.post("/factor-models/preview", json=_model_payload()))

    assert ready["status"] == "READY"
    assert len(ready["normalized_weights"]) == 4
    assert sum(abs(item["normalized_weight"]) for item in ready["normalized_weights"]) == 1.0
    assert ready["coverage"]["factor_count"] == 4
    assert ready["score_preview"]
    assert ready["coverage"]["estimated_factor_coverage"] != 0.965
    assert [item["score"] for item in ready["score_preview"]] != [0.1, 0.2, 0.3, 0.4]
    assert len({item["score"] for item in ready["score_preview"]}) > 1
    assert ready["pit_blockers"] == []
    assert ready["neutralization_status"]["status"] == "DISABLED"

    neutralized = assert_ok(client.post("/factor-models/preview", json=_model_payload(neutralization_enabled=True)))
    assert neutralized["status"] == "BLOCKED"
    assert "MISSING_INDUSTRY_PIT" in neutralized["neutralization_status"]["blockers"]


def test_factor_model_create_materializes_existing_strategy_and_rejects_missing_industry_pit(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)

    rejected = client.post("/factor-models", json=_model_payload(neutralization_enabled=True))
    assert rejected.status_code == 400
    assert "Industry neutralization" in rejected.json()["message"]

    created = assert_ok(client.post("/factor-models", json=_model_payload()))

    assert created["strategy_type"] == "MULTI_FACTOR"
    assert created["name"] == "单元测试多因子模型"
    assert created["current_parameter_version_id"]
    assert created["parameters"]["strategy_type"] == "MULTI_FACTOR"
    assert created["parameters"]["factor_ids"] == [
        "s_mom_12m1m_rank",
        "s_val_ep_ltm_raw",
        "s_vol_252d_rank",
        "s_size_cur_log",
    ]
    assert created["parameters"]["neutralization"] == {"enabled": False, "method": "industry"}
    assert created["parameter_history"][0]["source"]["kind"] == "factor_model_builder"
    assert created["multi_factor_profile"]["components"][0]["factor_id"] == "s_mom_12m1m_rank"
    assert created["multi_factor_profile"]["neutralization"]["execution_status"] == "DISABLED"
    assert created["multi_factor_parameter_ranges"]
    weight_ranges = {
        field["key"]: field["current"]
        for field in created["multi_factor_parameter_ranges"]
        if str(field["key"]).startswith("factor_weight__")
    }
    assert weight_ranges["factor_weight__s_mom_12m1m_rank_pct"] == 40
    assert weight_ranges["factor_weight__s_val_ep_ltm_raw_pct"] == 25

    strategy_id = created["id"]
    detail = assert_ok(client.get(f"/strategies/{strategy_id}/detail"))
    assert detail["multi_factor_profile"]["coverage_summary"]["factor_count"] == 4
    refresh_snapshots(client, mode="repair", targets=["corporate"])
    _seed_direct_price_history(client)

    preview = preview_backtest(
        client,
        strategy_id,
        start_date="2024-01-02",
        end_date="2024-06-28",
    )
    assert preview["multi_factor_precheck"]["status"] in {"PASS", "WARN"}
    assert preview["multi_factor_precheck"]["factor_count"] == 4

    run = submit_backtest(
        client,
        strategy_id,
        start_date="2024-01-02",
        end_date="2024-06-28",
    )
    assert run["multi_factor_attribution"]["attribution_source"] == "estimated"
    assert run["multi_factor_attribution"]["factor_contributions"]
    assert any(item["title"] == "因子归因" for item in run["analysis"]["decision_rail"]["items"])

    job = create_optimization_job(
        client,
        strategy_id,
        budget_combinations=1,
        wait_until_complete=False,
    )
    keys = [field["key"] for field in job["request"]["search_space"]]
    assert "scoring_method" in keys
    assert "rebalance_frequency" in keys
    assert any(key.startswith("factor_weight__") for key in keys)
    factor_weight_fields = [
        field
        for field in job["request"]["search_space"]
        if str(field["key"]).startswith("factor_weight__")
    ]
    assert factor_weight_fields
    assert {field.get("constraint_group") for field in factor_weight_fields} == {"allocation_weight_sum_100"}
    assert {field.get("constraint_target") for field in factor_weight_fields} == {100.0}

    service = client.app.state.service

    def fake_source_run_detail(_run_id):
        return {
            "id": run["id"],
            "metrics": {"total_return": 0.12, "sharpe": 1.1},
            "chart_series": [
                {"date": "2024-01-02", "strategy_return": 0.010, "is_oos": False},
                {"date": "2024-01-03", "strategy_return": -0.004, "is_oos": False},
                {"date": "2024-01-04", "strategy_return": 0.008, "is_oos": False},
                {"date": "2024-01-05", "strategy_return": 0.006, "is_oos": True},
                {"date": "2024-01-08", "strategy_return": -0.002, "is_oos": True},
                {"date": "2024-01-09", "strategy_return": 0.007, "is_oos": True},
            ],
        }

    monkeypatch.setattr(service, "get_backtest_run_detail", fake_source_run_detail)
    search_space = [
        {
            "key": "factor_weight__s_mom_12m1m_rank_pct",
            "label": "因子权重 · 动量",
            "mode": "range",
            "current": 40,
            "start": 35,
            "end": 45,
            "step": 5,
        },
        {
            "key": "factor_weight__s_val_ep_ltm_raw_pct",
            "label": "因子权重 · 估值",
            "mode": "range",
            "current": 25,
            "start": 20,
            "end": 30,
            "step": 5,
        },
        {
            "key": "factor_weight__s_vol_252d_rank_pct",
            "label": "因子权重 · 波动",
            "mode": "fixed",
            "current": 20,
            "value": 20,
        },
        {
            "key": "factor_weight__s_size_cur_log_pct",
            "label": "因子权重 · 规模",
            "mode": "fixed",
            "current": 15,
            "value": 15,
        },
    ]
    optimization_payload = {
        "objective": "return_sharpe",
        "source_run_id": run["id"],
        "search_space": search_space,
        "constraints": [
            {
                "key": "return_sharpe",
                "label": "收益夏普",
                "operator": ">=",
                "value": -999,
                "unit": "",
            }
        ],
    }
    strategy_detail = service.get_strategy_detail(strategy_id)
    trial_snapshots = [
        {
            "factor_weight__s_mom_12m1m_rank_pct": 35,
            "factor_weight__s_val_ep_ltm_raw_pct": 30,
            "factor_weight__s_vol_252d_rank_pct": 20,
            "factor_weight__s_size_cur_log_pct": 15,
        },
        {
            "factor_weight__s_mom_12m1m_rank_pct": 40,
            "factor_weight__s_val_ep_ltm_raw_pct": 25,
            "factor_weight__s_vol_252d_rank_pct": 20,
            "factor_weight__s_size_cur_log_pct": 15,
        },
        {
            "factor_weight__s_mom_12m1m_rank_pct": 45,
            "factor_weight__s_val_ep_ltm_raw_pct": 20,
            "factor_weight__s_vol_252d_rank_pct": 20,
            "factor_weight__s_size_cur_log_pct": 15,
        },
        {
            "factor_weight__s_mom_12m1m_rank_pct": 35,
            "factor_weight__s_val_ep_ltm_raw_pct": 20,
            "factor_weight__s_vol_252d_rank_pct": 20,
            "factor_weight__s_size_cur_log_pct": 15,
        },
    ]
    trials = []
    for index, snapshot in enumerate(trial_snapshots, start=1):
        trial = service._evaluate_optimization_trial(
            strategy_detail,
            {"source_run_id": run["id"]},
            dict(optimization_payload),
            snapshot,
        )
        trials.append(
            {
                **trial,
                "trial_index": index,
                "status": "SUCCEEDED",
                "id": f"trial_{index}",
            }
        )
    matching_combinations = service._build_optimization_matching_combination_candidates(
        strategy=strategy_detail,
        payload=optimization_payload,
        trials=trials,
    )
    assert matching_combinations
    for candidate in matching_combinations:
        snapshot = candidate["parameter_snapshot"]
        assert (
            snapshot["factor_weight__s_mom_12m1m_rank_pct"]
            + snapshot["factor_weight__s_val_ep_ltm_raw_pct"]
            + snapshot["factor_weight__s_vol_252d_rank_pct"]
            + snapshot["factor_weight__s_size_cur_log_pct"]
        ) == 100
    metric_signatures = {
        (
            round(candidate["metrics"]["return_sharpe"], 6),
            round(candidate["metrics"]["total_return_pct"], 6),
        )
        for candidate in matching_combinations
    }
    assert len(metric_signatures) > 1


def test_multi_factor_preview_uses_lightweight_precheck_without_full_simulation(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    created = assert_ok(client.post("/factor-models", json=_model_payload()))
    refresh_snapshots(client, mode="repair", targets=["corporate"])
    _seed_direct_price_history(client)

    def fail_full_simulation(*_args, **_kwargs):
        raise AssertionError("preview should not execute a full backtest simulation")

    monkeypatch.setattr(client.app.state.service, "_simulate_run", fail_full_simulation)

    preview = preview_backtest(
        client,
        created["id"],
        start_date="2024-01-02",
        end_date="2024-06-28",
    )

    assert preview["multi_factor_precheck"]["factor_count"] == 4
    assert preview["metrics"] == {}


def test_multi_factor_backtest_submit_rejects_missing_industry_pit_gate(tmp_path) -> None:
    client, db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    created = assert_ok(client.post("/factor-models", json=_model_payload()))
    parameters = dict(created["parameters"])
    parameters["neutralization"] = {"enabled": True, "method": "industry"}
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "UPDATE strategies SET parameters_json = ? WHERE id = ?",
            (json.dumps(parameters, ensure_ascii=False), created["id"]),
        )
        connection.execute(
            "UPDATE strategy_parameter_versions SET parameters_json = ? WHERE parameter_version_id = ?",
            (json.dumps(parameters, ensure_ascii=False), created["current_parameter_version_id"]),
        )

    response = client.post(
        f"/strategies/{created['id']}/backtest-runs",
        json={
            "idempotency_key": "blocked-neutralization-submit",
            "start_date": "2024-01-02",
            "end_date": "2024-06-28",
        },
    )

    assert response.status_code == 400
    assert "多因子预检未通过" in response.json()["message"]

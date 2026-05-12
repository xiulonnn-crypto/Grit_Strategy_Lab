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
from tests.test_factor_research_api import mark_price_snapshot_incomplete, seed_ready_pit_data


def _model_payload(
    *,
    neutralization_enabled: bool = False,
    universe: str = "SP500",
    rebalance_frequency: str = "monthly",
) -> dict:
    return {
        "name": "单元测试多因子模型",
        "universe": universe,
        "rebalance_frequency": rebalance_frequency,
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
    start = date(2023, 1, 3)
    end = date(2025, 6, 30)
    for symbol, offset in (
        ("AAPL", 0.0),
        ("MSFT", 3.0),
        ("NVDA", 6.0),
        ("AMZN", 9.0),
        ("META", 12.0),
        ("GOOGL", 15.0),
        ("TSLA", 18.0),
        ("AMD", 21.0),
        ("AVGO", 24.0),
        ("COST", 27.0),
        ("SPY", 30.0),
    ):
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


def _seed_sp500_industry_pit_metadata(client) -> None:
    repository = client.app.state.service.market_data_repository
    price_snapshot = next(
        (snapshot for snapshot in repository.list_dataset_snapshots() if snapshot.get("id") == "ds-price"),
        {},
    )
    as_of = str(price_snapshot.get("as_of") or price_snapshot.get("end_date") or date.today().isoformat())
    sectors = {
        "AAPL": ("Information Technology", "Technology Hardware"),
        "MSFT": ("Information Technology", "Systems Software"),
        "NVDA": ("Information Technology", "Semiconductors"),
        "AMZN": ("Consumer Discretionary", "Broadline Retail"),
        "META": ("Communication Services", "Interactive Media"),
        "GOOGL": ("Communication Services", "Interactive Media"),
        "TSLA": ("Consumer Discretionary", "Automobile Manufacturers"),
        "AMD": ("Information Technology", "Semiconductors"),
        "AVGO": ("Information Technology", "Semiconductors"),
        "COST": ("Consumer Staples", "Consumer Staples Merchandise Retail"),
    }
    repository.replace_universe_snapshot(
        {
            "id": "un-sp500",
            "universe_key": "SP500",
            "name": "S&P 500",
            "status": "READY",
            "as_of": as_of,
            "freshness_label": "unit industry PIT",
            "window_start": "2014-01-02",
            "window_end": as_of,
            "anchor_schedule": "01-01 / 07-01",
            "member_count": len(sectors),
            "source": "unit_test_revision",
            "fallback_source": "none",
            "metadata": {"coverage_mode": "point_in_time_anchor"},
        },
        memberships=[
            {
                "effective_date": "2014-01-02",
                "symbol": symbol,
                "source": "unit_test_gics_revision",
                "fallback_source": "none",
                "metadata": {
                    "source_quality": "historical_revision_snapshot",
                    "gics_sector": sector,
                    "sector": sector,
                    "gics_sub_industry": sub_industry,
                    "industry_name": sub_industry,
                    "industry_taxonomy": "GICS",
                    "industry_classification_source": "unit_test_gics_revision",
                    "industry_classification_effective_date": "2014-01-02",
                },
            }
            for symbol, (sector, sub_industry) in sectors.items()
        ],
    )
    with repository.connect() as conn:
        for symbol in sectors:
            conn.execute(
                """
                INSERT OR REPLACE INTO dataset_symbol_coverage (
                    dataset_snapshot_id, symbol, start_date, end_date, trade_days,
                    source, fallback_source, metadata_json
                )
                VALUES ('ds-price', ?, '2014-01-02', ?, 2520, 'unit_test', 'none', ?)
                """,
                (
                    symbol,
                    as_of,
                    json.dumps({"coverage_kind": "price_daily", "fixture": "sp500_industry_complete"}),
                ),
            )
        conn.execute(
            """
            UPDATE dataset_snapshots
            SET metadata_json = ?
            WHERE id = 'ds-price'
            """,
            (
                json.dumps(
                    {
                        "covered_symbol_count": len(sectors),
                        "total_symbol_count": len(sectors),
                        "fixture": "sp500_industry_complete",
                    }
                ),
            ),
        )
    service = client.app.state.service
    if hasattr(service, "_invalidate_pit_data_overview_cache"):
        service._invalidate_pit_data_overview_cache()


def _patch_factor_strategy_risks(client, monkeypatch, risks_by_factor: dict[str, dict]) -> None:
    service = client.app.state.service
    original_list_factors = service.list_factors

    def patched_list_factors(*args, **kwargs):
        result = original_list_factors(*args, **kwargs)
        items = []
        for item in result.get("items") or []:
            row = dict(item)
            factor_id = str(row.get("id") or "")
            if factor_id in risks_by_factor:
                row["strategy_creation_risk"] = dict(risks_by_factor[factor_id])
            items.append(row)
        return {**result, "items": items}

    monkeypatch.setattr(service, "list_factors", patched_list_factors)


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
    assert ready["strategy_creation_risk"]["can_create"] is True
    assert ready["strategy_creation_risk"]["warning_count"] >= 1
    assert ready["strategy_creation_risk"]["blocked_count"] == 0
    assert any(
        item["code"] in {"COVERAGE_EDGE", "HIGH_CORRELATION"}
        for item in ready["strategy_creation_risk"]["warnings"]
    )
    assert "可创建策略" in ready["strategy_creation_risk"]["summary"]

    neutralized = assert_ok(client.post("/factor-models/preview", json=_model_payload(neutralization_enabled=True)))
    assert neutralized["status"] == "BLOCKED"
    assert "MISSING_INDUSTRY_PIT" in neutralized["neutralization_status"]["blockers"]
    assert neutralized["strategy_creation_risk"]["can_create"] is False
    assert neutralized["strategy_creation_risk"]["blocked_count"] == 1
    assert any(
        item["code"] == "MISSING_INDUSTRY_PIT"
        for item in neutralized["strategy_creation_risk"]["hard_blockers"]
    )


def test_factor_model_industry_neutralization_uses_seeded_sp500_gics_pit(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    _seed_sp500_industry_pit_metadata(client)

    preview = assert_ok(client.post("/factor-models/preview", json=_model_payload(neutralization_enabled=True)))
    neutralization_status = preview["neutralization_status"]
    assert preview["status"] == "READY"
    assert neutralization_status["status"] == "EXECUTED"
    assert neutralization_status["blockers"] == []
    assert neutralization_status["taxonomy"] == "GICS"
    assert neutralization_status["covered_symbol_count"] == 10
    assert neutralization_status["missing_symbol_count"] == 0
    assert neutralization_status["industry_field"] == "universe_membership_snapshots.metadata.gics_sector"
    assert "unit_test_gics_revision" in neutralization_status["source_names"]

    created = assert_ok(client.post("/factor-models", json=_model_payload(neutralization_enabled=True)))
    strategy_id = created["id"]
    assert created["parameters"]["neutralization"]["execution_status"] == "EXECUTED"
    assert created["multi_factor_profile"]["neutralization"]["execution_status"] == "EXECUTED"
    assert created["multi_factor_profile"]["neutralization"]["covered_symbol_count"] == 10

    refresh_snapshots(client, mode="repair", targets=["corporate"])
    _seed_direct_price_history(client)
    precheck = preview_backtest(
        client,
        strategy_id,
        start_date="2024-01-02",
        end_date="2025-06-30",
    )["multi_factor_precheck"]
    assert precheck["status"] in {"PASS", "WARN"}
    assert precheck["neutralization_status"]["execution_status"] == "EXECUTED"
    assert precheck["neutralization_status"]["blockers"] == []

    run = submit_backtest(
        client,
        strategy_id,
        start_date="2024-01-02",
        end_date="2025-06-30",
    )
    assert run["chart_series"]
    assert run["metrics"]
    assert run["multi_factor_attribution"]["factor_contributions"]
    assert run["multi_factor_attribution"]["neutralization_status"]["execution_status"] == "EXECUTED"


def test_factor_model_preview_filters_industry_pit_memberships(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    _seed_sp500_industry_pit_metadata(client)
    repository = client.app.state.service.market_data_repository
    original_load_universe_memberships = repository.load_universe_memberships
    calls: list[dict] = []

    def tracked_load_universe_memberships(**kwargs):
        calls.append(dict(kwargs))
        if kwargs.get("universe_snapshot_id") == "un-sp500":
            assert kwargs.get("effective_date_lte")
            assert kwargs.get("active_only") is True
            assert set(kwargs.get("symbols") or []) == {
                "AAPL",
                "MSFT",
                "NVDA",
                "AMZN",
                "META",
                "GOOGL",
                "TSLA",
                "AMD",
                "AVGO",
                "COST",
            }
        return original_load_universe_memberships(**kwargs)

    monkeypatch.setattr(repository, "load_universe_memberships", tracked_load_universe_memberships)

    preview = assert_ok(client.post("/factor-models/preview", json=_model_payload(neutralization_enabled=True)))

    assert preview["neutralization_status"]["status"] == "EXECUTED"
    assert any(call.get("universe_snapshot_id") == "un-sp500" for call in calls)


def test_factor_model_strategy_creation_risk_warnings_do_not_block_create(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    _patch_factor_strategy_risks(
        client,
        monkeypatch,
        {
            "s_mom_12m1m_rank": {
                "warning_count": 1,
                "blocked_count": 0,
                "can_create": True,
                "warnings": [
                    {
                        "code": "HIGH_CORRELATION",
                        "message": "与同族动量因子高相关，仅提示组合拥挤风险。",
                        "related_factor_ids": ["s_mom_6m_rank"],
                    }
                ],
                "hard_blockers": [],
            }
        },
    )

    preview = assert_ok(client.post("/factor-models/preview", json=_model_payload()))

    assert preview["status"] == "READY"
    assert preview["pit_blockers"] == []
    risk = preview["strategy_creation_risk"]
    assert risk["can_create"] is True
    assert risk["warning_count"] >= 1
    assert risk["blocked_count"] == 0
    assert any(item["code"] == "HIGH_CORRELATION" for item in risk["warnings"])
    assert "只提示，不阻断创建" in risk["summary"]

    created = assert_ok(client.post("/factor-models", json=_model_payload()))
    assert created["parameters"]["preview"]["strategy_creation_risk"]["warning_count"] >= 1
    assert created["parameters"]["strategy_creation_risk"]["can_create"] is True


def test_factor_model_verified_pit_window_warning_does_not_block_create(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    service = client.app.state.service
    original_list_factors = service.list_factors

    def patched_list_factors(*args, **kwargs):
        result = original_list_factors(*args, **kwargs)
        items = []
        selected = {item["factor_id"] for item in _model_payload()["components"]}
        for item in result.get("items") or []:
            row = dict(item)
            if row.get("id") in selected:
                row["diagnostic_status"] = "SANDBOX_READY"
                row["readiness_blockers"] = [
                    {
                        "code": "VERIFIED_PIT_WINDOW_INCOMPLETE",
                        "message": "完整 Verified PIT 门禁未通过，当前仅允许 Sandbox 诊断。",
                        "severity": "WARNING",
                    }
                ]
            items.append(row)
        return {**result, "items": items}

    monkeypatch.setattr(service, "list_factors", patched_list_factors)

    preview = assert_ok(client.post("/factor-models/preview", json=_model_payload()))

    risk = preview["strategy_creation_risk"]
    assert preview["status"] == "READY"
    assert risk["can_create"] is True
    assert risk["blocked_count"] == 0
    assert any(item["code"] == "VERIFIED_PIT_WINDOW_INCOMPLETE" for item in risk["warnings"])
    assert not any(item["code"] == "VERIFIED_PIT_WINDOW_INCOMPLETE" for item in risk["hard_blockers"])


def test_factor_model_low_risk_non_core_price_gap_allows_sandbox_create(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    mark_price_snapshot_incomplete(client, missing_symbols=[f"ZZZ{i:03d}" for i in range(209)])
    _patch_factor_strategy_risks(
        client,
        monkeypatch,
        {
            "s_mom_12m1m_rank": {
                "warning_count": 0,
                "blocked_count": 1,
                "can_create": False,
                "warnings": [],
                "hard_blockers": [
                    {
                        "code": "PRICE_SNAPSHOT_NOT_READY",
                        "message": "价格 PIT 缺口需要确认。",
                    }
                ],
            }
        },
    )

    preview = assert_ok(client.post("/factor-models/preview", json=_model_payload()))

    assert preview["status"] == "READY"
    risk = preview["strategy_creation_risk"]
    assert risk["can_create"] is True
    assert risk["blocked_count"] == 0
    assert risk["summary_label"] == "低风险准入"
    assert "PIT核心成员价格缺口为 0" in risk["summary"]
    assert "209 个Full Ready归档缺口" in risk["summary"]
    assert any(
        item["code"] == "PRICE_SNAPSHOT_NOT_READY"
        and item["severity"] == "WARNING"
        and item.get("admission_risk_context", {}).get("non_core_missing_count") == 209
        for item in risk["warnings"]
    )

    created = assert_ok(client.post("/factor-models", json=_model_payload()))
    assert created["strategy_type"] == "MULTI_FACTOR"
    assert created["parameters"]["strategy_creation_risk"]["summary_label"] == "低风险准入"


def test_factor_model_strategy_creation_risk_hard_blocker_blocks_create(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    _patch_factor_strategy_risks(
        client,
        monkeypatch,
        {
            "s_val_ep_ltm_raw": {
                "warning_count": 0,
                "blocked_count": 1,
                "can_create": False,
                "warnings": [],
                "hard_blockers": [
                    {
                        "code": "UNSAFE_EXPRESSION",
                        "message": "表达式包含 unsafe expression，不能进入正式可回放策略。",
                    }
                ],
            }
        },
    )

    preview = assert_ok(client.post("/factor-models/preview", json=_model_payload()))

    assert preview["status"] == "BLOCKED"
    risk = preview["strategy_creation_risk"]
    assert risk["can_create"] is False
    assert risk["warning_count"] >= 0
    assert risk["blocked_count"] == 1
    assert any(item["code"] == "UNSAFE_EXPRESSION" for item in risk["hard_blockers"])
    assert any(item["code"] == "UNSAFE_EXPRESSION" for item in preview["pit_blockers"])

    rejected = client.post("/factor-models", json=_model_payload())
    assert rejected.status_code == 400
    assert "策略创建风险" in rejected.json()["message"]


def test_factor_model_create_preserves_selected_rebalance_frequency(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)

    created = assert_ok(client.post("/factor-models", json=_model_payload(rebalance_frequency="yearly")))

    assert created["rebalance_frequency"] == "yearly"
    assert created["parameters"]["rebalance_frequency"] == "yearly"
    assert created["multi_factor_profile"]["rebalance_frequency"] == "yearly"
    detail = assert_ok(client.get(f"/strategies/{created['id']}/detail"))
    assert detail["rebalance_frequency"] == "yearly"
    assert detail["parameters"]["rebalance_frequency"] == "yearly"
    assert detail["multi_factor_profile"]["rebalance_frequency"] == "yearly"


def test_multi_factor_strategy_detail_uses_lightweight_factor_index(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    created = assert_ok(client.post("/factor-models", json=_model_payload()))
    service = client.app.state.service
    service._multi_factor_factor_index_cache = None

    def fail_heavy_factor_list(*args, **kwargs):
        raise AssertionError("strategy detail should not hydrate the full factor governance list")

    monkeypatch.setattr(service, "list_factors", fail_heavy_factor_list)

    detail = assert_ok(client.get(f"/strategies/{created['id']}/detail"))

    components = detail["multi_factor_profile"]["components"]
    assert [item["factor_id"] for item in components] == created["parameters"]["factor_ids"]
    assert components[0]["name"]


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
    assert created["parameters"]["preview"]["strategy_creation_risk"]["can_create"] is True
    assert created["parameters"]["strategy_creation_risk"]["blocked_count"] == 0
    assert created["rebalance_frequency"] == "monthly"
    assert created["parameters"]["rebalance_frequency"] == "monthly"
    assert created["parameter_history"][0]["source"]["kind"] == "factor_model_builder"
    assert created["multi_factor_profile"]["components"][0]["factor_id"] == "s_mom_12m1m_rank"
    assert created["multi_factor_profile"]["neutralization"]["execution_status"] == "DISABLED"
    assert created["multi_factor_parameter_ranges"]
    range_keys = [field["key"] for field in created["multi_factor_parameter_ranges"]]
    assert "neutralization_method" in range_keys
    assert "neutralization_enabled" not in range_keys
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
    assert detail["multi_factor_profile"]["rebalance_frequency"] == "monthly"
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
    assert "neutralization_method" in keys
    assert "neutralization_enabled" not in keys
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


def test_multi_factor_optimization_projection_normalizes_weights_and_dedupes_cadence_rows(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    created = assert_ok(client.post("/factor-models", json=_model_payload()))
    strategy_id = created["id"]
    run = submit_backtest(
        client,
        strategy_id,
        start_date="2024-01-02",
        end_date="2024-06-28",
    )
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
    strategy_detail = service.get_strategy_detail(strategy_id)
    search_space = service._normalize_optimization_search_space(
        strategy_detail,
        {
            "search_space": [
                {
                    "key": "factor_weight__s_mom_12m1m_rank_pct",
                    "label": "Momentum weight",
                    "mode": "range",
                    "current": 40,
                    "start": 35,
                    "end": 45,
                    "step": 5,
                },
                {
                    "key": "factor_weight__s_val_ep_ltm_raw_pct",
                    "label": "Value weight",
                    "mode": "range",
                    "current": 25,
                    "start": 20,
                    "end": 30,
                    "step": 5,
                },
                {
                    "key": "factor_weight__s_vol_252d_rank_pct",
                    "label": "Volatility weight",
                    "mode": "fixed",
                    "current": 20,
                    "value": 20,
                },
                {
                    "key": "factor_weight__s_size_cur_log_pct",
                    "label": "Size weight",
                    "mode": "fixed",
                    "current": 15,
                    "value": 15,
                },
                {
                    "key": "rebalance_frequency",
                    "label": "Rebalance cadence",
                    "mode": "discrete",
                    "current": "monthly",
                    "value": "monthly",
                    "values": ["monthly", "quarterly", "yearly"],
                },
            ],
        },
    )
    rebalance_field = next(field for field in search_space if field["key"] == "rebalance_frequency")
    assert rebalance_field["mode"] == "fixed"
    assert rebalance_field["values"] == ["monthly"]

    optimization_payload = {
        "objective": "return_sharpe",
        "source_run_id": run["id"],
        "search_space": search_space,
        "constraints": [
            {
                "key": "return_sharpe",
                "label": "Return Sharpe",
                "operator": ">=",
                "value": -999,
                "unit": "",
            }
        ],
    }
    trial_snapshots = [
        {
            "factor_weight__s_mom_12m1m_rank_pct": 45,
            "factor_weight__s_val_ep_ltm_raw_pct": 20,
            "factor_weight__s_vol_252d_rank_pct": 20,
            "factor_weight__s_size_cur_log_pct": 15,
            "rebalance_frequency": "monthly",
        },
        {
            "factor_weight__s_mom_12m1m_rank_pct": 45,
            "factor_weight__s_val_ep_ltm_raw_pct": 20,
            "factor_weight__s_vol_252d_rank_pct": 20,
            "factor_weight__s_size_cur_log_pct": 15,
            "rebalance_frequency": "yearly",
        },
        {
            "factor_weight__s_mom_12m1m_rank_pct": 50,
            "factor_weight__s_val_ep_ltm_raw_pct": 15,
            "factor_weight__s_vol_252d_rank_pct": 20,
            "factor_weight__s_size_cur_log_pct": 15,
            "rebalance_frequency": "monthly",
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
        assert (
            trial["parameter_snapshot"]["weights"]["s_mom_12m1m_rank"]
            == snapshot["factor_weight__s_mom_12m1m_rank_pct"]
        )
        assert (
            trial["parameter_snapshot"]["weights"]["s_val_ep_ltm_raw"]
            == snapshot["factor_weight__s_val_ep_ltm_raw_pct"]
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
    assert len(matching_combinations) == 2
    weight_signatures = {
        tuple(sorted(candidate["parameter_snapshot"]["weights"].items()))
        for candidate in matching_combinations
    }
    assert (
        ("s_mom_12m1m_rank", 45.0),
        ("s_size_cur_log", 15.0),
        ("s_val_ep_ltm_raw", 20.0),
        ("s_vol_252d_rank", 20.0),
    ) in weight_signatures
    assert (
        ("s_mom_12m1m_rank", 50.0),
        ("s_size_cur_log", 15.0),
        ("s_val_ep_ltm_raw", 15.0),
        ("s_vol_252d_rank", 20.0),
    ) in weight_signatures
    projected_effects = {
        candidate["metrics"]["multi_factor_projection_effect"]
        for candidate in matching_combinations
    }
    assert len(projected_effects) == 2

    stale_saturated_trials = [
        {
            **trials[0],
            "id": "trial_stale_cap_a",
            "trial_index": 11,
            "metrics": {
                **trials[0]["metrics"],
                "multi_factor_projection_effect": 0.12,
            },
            "score": 100.0,
        },
        {
            **trials[-1],
            "id": "trial_stale_cap_b",
            "trial_index": 12,
            "metrics": {
                **trials[0]["metrics"],
                "multi_factor_projection_effect": 0.12,
            },
            "score": 100.0,
        },
    ]
    stale_matching_combinations = service._build_optimization_matching_combination_candidates(
        strategy=strategy_detail,
        payload=optimization_payload,
        trials=stale_saturated_trials,
    )
    assert len(stale_matching_combinations) == 1


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

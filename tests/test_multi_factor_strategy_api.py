from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta

import pytest

from tests.api_test_support import (
    assert_ok,
    create_optimization_job,
    create_test_client,
    preview_backtest,
    refresh_snapshots,
    submit_backtest,
)
from tests.test_factor_research_api import (
    governance_ready_summary,
    mark_price_snapshot_incomplete,
    seed_factor_diagnostic_summary,
    seed_ready_pit_data,
)


def _model_payload(
    *,
    neutralization_enabled: bool = False,
    universe: str = "SP500",
    rebalance_frequency: str = "monthly",
    top_n: int = 8,
) -> dict:
    return {
        "name": "单元测试多因子模型",
        "universe": universe,
        "rebalance_frequency": rebalance_frequency,
        "top_n": top_n,
        "scoring_method": "zscore_weighted",
        "components": [
            {"factor_id": "s_mom_12m1m_rank", "weight": 40, "direction": "HIGH_IS_BETTER"},
            {"factor_id": "s_val_ep_ltm_raw", "weight": 25, "direction": "HIGH_IS_BETTER"},
            {"factor_id": "s_vol_252d_rank", "weight": 20, "direction": "LOW_IS_BETTER"},
            {"factor_id": "s_size_cur_log", "weight": 15, "direction": "LOW_IS_BETTER"},
        ],
        "neutralization": {"enabled": neutralization_enabled, "method": "industry"},
    }


def _composite_payload(
    *,
    cap_redistribution_mode: str = "cash",
    sector_cap_pct: float = 20.0,
    top_n: int = 50,
) -> dict:
    return {
        "strategy_type": "COMPOSITE_FACTOR",
        "name": "Composite factor strategy",
        "universe": "SP500",
        "rebalance_frequency": "monthly",
        "top_n": top_n,
        "scoring_method": "zscore_weighted",
        "components": [
            {"factor_id": "s_mom_12m1m_rank", "weight": 100, "direction": "HIGH_IS_BETTER"},
        ],
        "neutralization": {"enabled": False, "method": "industry"},
        "universe_filter": {
            "min_adv_usd": 5_000_000,
            "adv_window": "20D",
            "exclude_halted": True,
            "exclude_otc_pink": True,
            "exclude_luld_paused": True,
            "delisting_window_days": 30,
            "sector_overrides": {"utilities": True, "real_estate": False},
        },
        "weight_mapping": {
            "method": "equal_top_k",
            "sector_cap_pct": sector_cap_pct,
            "max_position_pct": 8,
            "min_target_weight_pct": 0.25,
            "cap_redistribution_mode": cap_redistribution_mode,
        },
        "rebalance_logic": {
            "frequency": "monthly",
            "calendar_rule": "first_trading_day",
            "exit_rank_percentile": 20,
            "min_trade_notional_usd": 10_000,
        },
        "execution_constraints": {
            "notional_usd": 10_000_000,
            "commission_bps": 1.5,
            "stamp_tax_bps": 0,
            "base_slippage_bps": 2.5,
            "impact_beta": 0.65,
            "max_impact_bps": 75,
        },
    }


def _patch_composite_factor_admission(
    client,
    monkeypatch,
    factor_id: str = "s_mom_12m1m_rank",
    factor_level: str = "S",
) -> None:
    service = client.app.state.service
    original_list_factors = service.list_factors

    def patched_list_factors(*args, **kwargs):
        result = original_list_factors(*args, **kwargs)
        items = []
        for item in result.get("items") or []:
            row = dict(item)
            if row.get("id") == factor_id:
                row.update(
                    {
                        "market": "US",
                        "tier_level": "F3",
                        "tier_projection": {"key": "F3"},
                        "factor_level": factor_level,
                        "factor_level_projection": {"key": factor_level},
                        "diagnostic_status": "COMPLETED",
                        "op_status": {
                            "completed": ["W", "N", "Z", "T"],
                            "missing": [],
                            "lights": [
                                {"code": code, "key": code, "label": code, "active": True, "status": "done"}
                                for code in ["W", "N", "Z", "T"]
                            ],
                        },
                        "latest_diagnostic_summary": {
                            **dict(row.get("latest_diagnostic_summary") or {}),
                            "status": "COMPLETED",
                            "rank_ic": 0.061,
                            "ic": 0.052,
                            "ir": 1.34,
                            "coverage": 0.92,
                            "group_returns": [
                                {"group": "Technology", "mean_return": 0.024, "sample_count": 120},
                                {"group": "Utilities", "mean_return": -0.018, "sample_count": 48},
                                {"group": "Real Estate", "mean_return": -0.012, "sample_count": 36},
                            ],
                            "risk_flags": ["Utilities underperformed in diagnostics"],
                        },
                    }
                )
            items.append(row)
        return {**result, "items": items}

    monkeypatch.setattr(service, "list_factors", patched_list_factors)


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


def _seed_divergent_multi_factor_price_history(client) -> None:
    bars = []
    coverage = []
    start = date(2022, 1, 3)
    end = date(2025, 6, 30)
    symbol_profiles = {
        "AAPL": (0.0018, 0.0025),
        "MSFT": (0.0009, 0.0004),
        "NVDA": (0.0024, 0.0045),
        "AMZN": (0.0013, 0.0016),
        "META": (0.0007, 0.0003),
        "GOOGL": (0.0011, 0.0005),
        "TSLA": (0.0019, 0.0052),
        "AMD": (0.0021, 0.0038),
        "AVGO": (0.0015, 0.0008),
        "COST": (0.0008, 0.0002),
        "SPY": (0.0010, 0.0006),
    }
    for symbol, (drift, amplitude) in symbol_profiles.items():
        trade_days = 0
        cursor = start
        price = 100.0 + trade_days
        while cursor <= end:
            if cursor.weekday() < 5:
                oscillation = amplitude if trade_days % 2 == 0 else -amplitude * 0.85
                daily_return = drift + oscillation
                price = round(price * (1.0 + daily_return), 6)
                high = round(price * (1.0 + abs(amplitude) * 0.6 + 0.001), 6)
                low = round(price * (1.0 - abs(amplitude) * 0.6 - 0.001), 6)
                bars.append(
                    {
                        "symbol": symbol,
                        "date": cursor.isoformat(),
                        "open": price,
                        "high": high,
                        "low": low,
                        "close": price,
                        "adj_close": price,
                        "volume": 1_000_000 + trade_days * 100,
                        "source": "test_seed_divergent",
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
                "source": "test_seed_divergent",
            }
        )
    client.app.state.service.market_data_repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "多因子分歧价格快照",
            "status": "READY",
            "as_of": end.isoformat(),
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "row_count": len(bars),
            "source": "test_seed_divergent",
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


def test_composite_factor_sector_cap_refill_preserves_cut_weight_and_full_investment(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    service = client.app.state.service

    capped, cut_weight, residual_cash, sectors = service._apply_factor_weight_caps(
        {"AAPL": 0.30, "MSFT": 0.30, "JNJ": 0.20, "JPM": 0.20},
        {"AAPL": 0.9, "MSFT": 0.8, "JNJ": 0.7, "JPM": 0.6},
        {"AAPL": "Technology", "MSFT": "Technology", "JNJ": "Health Care", "JPM": "Financials"},
        max_position_pct=100,
        sector_cap_pct=40,
        redistribution_mode="proportional_refill",
    )

    by_sector: dict[str, float] = {}
    for symbol, weight in capped.items():
        sector = {"AAPL": "Technology", "MSFT": "Technology", "JNJ": "Health Care", "JPM": "Financials"}[symbol]
        by_sector[sector] = by_sector.get(sector, 0.0) + weight
    assert by_sector["Technology"] == pytest.approx(0.40)
    assert sum(capped.values()) == pytest.approx(1.0)
    assert cut_weight == pytest.approx(0.20)
    assert residual_cash == pytest.approx(0.0)
    assert sectors[0]["sector"] == "Technology"
    assert sectors[0]["cut_pct"] == pytest.approx(20.0)


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


def test_composite_factor_preview_reports_admission_diagnostic_sector_cap_and_cost(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    _seed_sp500_industry_pit_metadata(client)
    _patch_composite_factor_admission(client, monkeypatch)

    preview = assert_ok(client.post("/factor-models/preview", json=_composite_payload()))

    assert preview["strategy_type"] == "COMPOSITE_FACTOR"
    assert preview["status"] == "READY"
    risk = preview["strategy_creation_risk"]
    assert risk["eligibility"]["can_create"] is True
    assert risk["eligibility"]["completed_ops"] == ["N", "T", "W", "Z"]
    assert risk["eligibility"]["missing_ops"] == []
    assert preview["diagnostic_summary"]["weak_sectors"]
    assert preview["diagnostic_summary"]["weak_sectors"][0]["group"] in {"Utilities", "Real Estate"}
    assert preview["sector_cap_forecast"]["top_n"] == 50
    assert preview["sector_cap_forecast"]["cap_redistribution_mode"] == "cash"
    assert preview["sector_cap_forecast"]["residual_cash_pct"] >= 0
    assert preview["cost_forecast"]["average_slippage_bps"] > 0

    blocked_payload = _composite_payload()
    blocked_payload["components"] = [
        {"factor_id": "s_mom_12m1m_rank", "weight": 50, "direction": "HIGH_IS_BETTER"},
        {"factor_id": "s_val_ep_ltm_raw", "weight": 50, "direction": "HIGH_IS_BETTER"},
    ]
    blocked = assert_ok(client.post("/factor-models/preview", json=blocked_payload))

    assert blocked["status"] == "BLOCKED"
    assert blocked["strategy_creation_risk"]["eligibility"]["can_create"] is False
    blocker_codes = {item["code"] for item in blocked["strategy_creation_risk"]["hard_blockers"]}
    assert "COMPOSITE_SINGLE_FACTOR" in blocker_codes


def test_composite_factor_preview_accepts_b_grade_source_factor(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    _seed_sp500_industry_pit_metadata(client)
    _patch_composite_factor_admission(client, monkeypatch, factor_level="B")

    preview = assert_ok(client.post("/factor-models/preview", json=_composite_payload()))

    assert preview["strategy_type"] == "COMPOSITE_FACTOR"
    assert preview["status"] == "READY"
    risk = preview["strategy_creation_risk"]
    assert risk["eligibility"]["can_create"] is True
    assert risk["eligibility"]["factor_level"] == "B"
    blocker_codes = {item["code"] for item in risk["hard_blockers"]}
    assert "COMPOSITE_GRADE_SAB" not in blocker_codes


def test_composite_factor_preview_accepts_wnzt_ffblend_seed(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    _seed_sp500_industry_pit_metadata(client)
    assert_ok(client.get("/factors"))
    seed_factor_diagnostic_summary(
        client,
        "s_alpha_ffblend_resid_mkt_rank",
        governance_ready_summary(rank_ic=0.058, ir=1.18, coverage=98.0),
        run_id="diag-alpha-ffblend-wnzt",
    )

    payload = _composite_payload()
    payload["components"] = [
        {"factor_id": "s_alpha_ffblend_resid_mkt_rank", "weight": 100, "direction": "HIGH_IS_BETTER"},
    ]
    preview = assert_ok(client.post("/factor-models/preview", json=payload))

    assert preview["status"] == "READY"
    risk = preview["strategy_creation_risk"]
    assert risk["eligibility"]["can_create"] is True
    assert risk["eligibility"]["completed_ops"] == ["N", "T", "W", "Z"]
    assert risk["eligibility"]["missing_ops"] == []
    assert preview["score_preview"]
    assert len({item["score"] for item in preview["score_preview"]}) > 1


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


def test_multi_factor_backtest_prefetches_industry_memberships_once_for_execution(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    _seed_sp500_industry_pit_metadata(client)

    created = assert_ok(client.post("/factor-models", json=_model_payload(neutralization_enabled=True)))
    strategy_id = created["id"]

    refresh_snapshots(client, mode="repair", targets=["corporate"])
    _seed_direct_price_history(client)

    repository = client.app.state.service.market_data_repository
    original_load_universe_memberships = repository.load_universe_memberships
    calls: list[dict] = []

    def tracked_load_universe_memberships(**kwargs):
        calls.append(dict(kwargs))
        return original_load_universe_memberships(**kwargs)

    monkeypatch.setattr(repository, "load_universe_memberships", tracked_load_universe_memberships)

    run = submit_backtest(
        client,
        strategy_id,
        start_date="2024-01-02",
        end_date="2025-06-30",
        idempotency_key="run-mf-membership-prefetch",
    )

    assert run["status"] in {"COMPLETED", "COMPLETED_WITH_WARNINGS"}
    assert len(calls) == 1
    execution_calls = [call for call in calls if call.get("active_only") is True]
    assert len(execution_calls) == 1
    assert execution_calls[0].get("universe_snapshot_id") == "un-sp500"
    assert execution_calls[0].get("effective_date_lte") == "2025-06-02"


def test_multi_factor_simulation_emits_preparation_progress_updates(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    created = assert_ok(client.post("/factor-models", json=_model_payload()))
    strategy_id = created["id"]

    refresh_snapshots(client, mode="repair", targets=["corporate"])
    _seed_direct_price_history(client)

    service = client.app.state.service
    strategy = service.get_strategy_detail(strategy_id)
    request_payload = service._normalize_run_request(
        strategy,
        {
            "idempotency_key": "run-mf-prepare-progress",
            "start_date": "2024-01-02",
            "end_date": "2025-06-30",
            "parameter_version_id": strategy["current_parameter_version_id"],
        },
    )
    prepared_context = service._prepare_backtest_run_context(strategy, request_payload)
    progress_states: list[dict[str, object]] = []

    monkeypatch.setattr(
        service.market_data_repository,
        "load_dataset_fundamental_points",
        lambda *_args, **_kwargs: {},
    )
    monkeypatch.setattr(
        service,
        "_factor_expression_series",
        lambda _expression, price_rows, _fundamental_rows: [1.0] * len(price_rows),
    )

    preview, chart_series, trades = service._simulate_run_from_prepared_context(
        strategy,
        request_payload,
        prepared_context,
        preparation_progress_callback=lambda state: progress_states.append(dict(state)),
    )

    assert preview["effective_date"] is not None
    assert chart_series
    assert trades
    assert progress_states
    assert progress_states[0]["current_stage"] == "Preparing multi-factor signals"
    assert str(progress_states[0]["latest_update"]).startswith("Loading fundamental history")
    assert any("Computing factor" in str(state.get("latest_update") or "") for state in progress_states)
    assert any("Starting day-by-day simulation" in str(state.get("latest_update") or "") for state in progress_states)


def test_multi_factor_attribution_uses_diagnostic_quality_for_equal_weights(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    service = client.app.state.service
    monkeypatch.setattr(
        service,
        "_multi_factor_factor_index",
        lambda: {
            "factor_high_quality": {
                "name": "High quality factor",
                "category": "momentum",
                "direction": "HIGH_IS_BETTER",
                "latest_diagnostic_summary": {
                    "rank_ic": 0.52,
                    "ir": 1.2,
                    "coverage": 100.0,
                },
            },
            "factor_low_quality": {
                "name": "Low quality factor",
                "category": "alpha",
                "direction": "HIGH_IS_BETTER",
                "latest_diagnostic_summary": {
                    "rank_ic": 0.04,
                    "ir": 0.3,
                    "coverage": 55.0,
                },
            },
        },
    )
    run = {
        "metrics": {"total_return": 0.24},
        "parameter_snapshot": {
            "strategy_type": "MULTI_FACTOR",
            "factor_ids": ["factor_high_quality", "factor_low_quality"],
            "weights": {
                "factor_high_quality": 50,
                "factor_low_quality": 50,
            },
        },
    }

    attribution = service._build_multi_factor_attribution(run)

    contributions = attribution["factor_contributions"]
    contribution_by_id = {item["factor_id"]: item for item in contributions}
    high = contribution_by_id["factor_high_quality"]
    low = contribution_by_id["factor_low_quality"]
    assert high["normalized_weight"] == low["normalized_weight"] == 0.5
    assert high["diagnostic_score"] > low["diagnostic_score"]
    assert high["contribution_pct"] > low["contribution_pct"]
    assert high["contribution_pct"] != low["contribution_pct"]
    assert high["basis"] == "diagnostic_adjusted_weight"
    assert sum(item["contribution_pct"] for item in contributions) == pytest.approx(24.0, abs=0.02)


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


def test_legacy_multi_factor_strategy_rows_backfill_default_top_n_for_library_and_detail(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    created = assert_ok(client.post("/factor-models", json=_model_payload()))
    strategy_id = created["id"]
    service = client.app.state.service

    legacy_parameters = dict(created["parameters"])
    legacy_parameters.pop("top_n", None)
    legacy_parameters.pop("holding_count", None)

    legacy_history = [dict(entry) for entry in created["parameter_history"]]
    legacy_history[0] = {
        **legacy_history[0],
        "parameters": dict(legacy_history[0]["parameters"]),
    }
    legacy_history[0]["parameters"].pop("top_n", None)
    legacy_history[0]["parameters"].pop("holding_count", None)

    service.storage.execute(
        """
        UPDATE strategies
        SET parameters_json = ?, parameter_history_json = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            json.dumps(legacy_parameters),
            json.dumps(legacy_history),
            "2026-05-14T10:00:00Z",
            strategy_id,
        ),
    )

    library_rows = assert_ok(client.get("/strategies"))
    library_row = next(item for item in library_rows if item["id"] == strategy_id)
    assert library_row["parameters"]["top_n"] == 8
    assert library_row["parameters"]["holding_count"] == 8

    detail = assert_ok(client.get(f"/strategies/{strategy_id}/detail"))
    assert detail["parameters"]["top_n"] == 8
    assert detail["parameters"]["holding_count"] == 8
    assert detail["parameter_history"][0]["parameters"]["top_n"] == 8
    top_n_range = next(
        field for field in detail["multi_factor_parameter_ranges"] if field["key"] == "top_n"
    )
    assert top_n_range["current"] == 8


def test_composite_factor_create_runs_backtest_and_optimization_path(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    _seed_sp500_industry_pit_metadata(client)
    _patch_composite_factor_admission(client, monkeypatch)

    created = assert_ok(
        client.post(
            "/factor-models",
            json=_composite_payload(cap_redistribution_mode="proportional_refill", sector_cap_pct=35),
        )
    )

    assert created["strategy_type"] == "COMPOSITE_FACTOR"
    assert created["parameters"]["strategy_type"] == "COMPOSITE_FACTOR"
    assert created["parameters"]["factor_model_type"] == "COMPOSITE_FACTOR"
    assert created["parameters"]["factor_ids"] == ["s_mom_12m1m_rank"]
    assert created["parameters"]["weights"] == {"s_mom_12m1m_rank": 100}
    assert created["parameters"]["top_n"] == 50
    assert created["parameters"]["weight_mapping"]["sector_cap_pct"] == 35
    assert created["parameters"]["weight_mapping"]["cap_redistribution_mode"] == "proportional_refill"
    assert created["parameters"]["sector_cap_forecast"]["cap_redistribution_mode"] == "proportional_refill"
    assert created["parameters"]["cost_forecast"]["average_slippage_bps"] > 0
    assert created["multi_factor_profile"]["coverage_summary"]["factor_count"] == 1

    strategy_id = created["id"]
    refresh_snapshots(client, mode="repair", targets=["corporate"])
    _seed_direct_price_history(client)

    preview = preview_backtest(
        client,
        strategy_id,
        start_date="2024-01-02",
        end_date="2024-06-28",
    )
    assert preview["multi_factor_precheck"]["factor_count"] == 1
    assert preview["multi_factor_precheck"]["status"] in {"PASS", "WARN"}

    run = submit_backtest(
        client,
        strategy_id,
        start_date="2024-01-02",
        end_date="2024-06-28",
    )
    assert run["parameter_snapshot"]["strategy_type"] == "COMPOSITE_FACTOR"
    assert run["parameter_snapshot"]["weight_mapping"]["sector_cap_pct"] == 35

    job = create_optimization_job(
        client,
        strategy_id,
        budget_combinations=1,
        wait_until_complete=False,
    )
    keys = {field["key"] for field in job["request"]["search_space"]}
    assert {"top_n", "scoring_method", "rebalance_frequency"}.issubset(keys)


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
    assert created["parameters"]["top_n"] == 8
    assert created["parameters"]["preview"]["strategy_creation_risk"]["can_create"] is True
    assert created["parameters"]["strategy_creation_risk"]["blocked_count"] == 0
    assert created["rebalance_frequency"] == "monthly"
    assert created["parameters"]["rebalance_frequency"] == "monthly"
    assert created["parameter_history"][0]["source"]["kind"] == "factor_model_builder"
    assert created["multi_factor_profile"]["components"][0]["factor_id"] == "s_mom_12m1m_rank"
    assert created["multi_factor_profile"]["neutralization"]["execution_status"] == "DISABLED"
    assert created["multi_factor_parameter_ranges"]
    range_keys = [field["key"] for field in created["multi_factor_parameter_ranges"]]
    assert "top_n" in range_keys
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
    assert run["parameter_snapshot"]["top_n"] == 8
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
    assert "top_n" in keys
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


def test_multi_factor_backtest_uses_selected_factor_basket_for_ranking(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    refresh_snapshots(client, mode="repair", targets=["corporate"])
    _seed_divergent_multi_factor_price_history(client)

    momentum_payload = {
        "name": "动量单因子模型",
        "universe": "SP500",
        "rebalance_frequency": "monthly",
        "scoring_method": "zscore_weighted",
        "components": [
            {"factor_id": "s_mom_12m1m_rank", "weight": 100, "direction": "HIGH_IS_BETTER"},
        ],
        "neutralization": {"enabled": False, "method": "industry"},
    }
    low_vol_payload = {
        "name": "低波单因子模型",
        "universe": "SP500",
        "rebalance_frequency": "monthly",
        "scoring_method": "zscore_weighted",
        "components": [
            {"factor_id": "s_vol_252d_rank", "weight": 100, "direction": "LOW_IS_BETTER"},
        ],
        "neutralization": {"enabled": False, "method": "industry"},
    }

    momentum_strategy = assert_ok(client.post("/factor-models", json=momentum_payload))
    low_vol_strategy = assert_ok(client.post("/factor-models", json=low_vol_payload))

    momentum_run = submit_backtest(
        client,
        momentum_strategy["id"],
        start_date="2024-01-02",
        end_date="2025-06-30",
        idempotency_key="mf-basket-momentum",
    )
    low_vol_run = submit_backtest(
        client,
        low_vol_strategy["id"],
        start_date="2024-01-02",
        end_date="2025-06-30",
        idempotency_key="mf-basket-low-vol",
    )

    assert momentum_run["parameter_snapshot"]["factor_ids"] == ["s_mom_12m1m_rank"]
    assert low_vol_run["parameter_snapshot"]["factor_ids"] == ["s_vol_252d_rank"]
    assert momentum_run["metrics"]["total_return"] != pytest.approx(low_vol_run["metrics"]["total_return"])
    assert momentum_run["metrics"]["sharpe"] != pytest.approx(low_vol_run["metrics"]["sharpe"])
    assert momentum_run["chart_series"] != low_vol_run["chart_series"]


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
                {
                    "key": "top_n",
                    "label": "持仓数量",
                    "mode": "range",
                    "current": 8,
                    "start": 6,
                    "end": 10,
                    "step": 2,
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
            "top_n": 8,
        },
        {
            "factor_weight__s_mom_12m1m_rank_pct": 45,
            "factor_weight__s_val_ep_ltm_raw_pct": 20,
            "factor_weight__s_vol_252d_rank_pct": 20,
            "factor_weight__s_size_cur_log_pct": 15,
            "rebalance_frequency": "yearly",
            "top_n": 10,
        },
        {
            "factor_weight__s_mom_12m1m_rank_pct": 50,
            "factor_weight__s_val_ep_ltm_raw_pct": 15,
            "factor_weight__s_vol_252d_rank_pct": 20,
            "factor_weight__s_size_cur_log_pct": 15,
            "rebalance_frequency": "monthly",
            "top_n": 8,
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
    assert len(matching_combinations) == 3
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
    assert len(projected_effects) == 3
    assert {candidate["parameter_snapshot"]["top_n"] for candidate in matching_combinations} == {8, 10}

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
    assert len(stale_matching_combinations) == 2
    assert {candidate["id"] for candidate in stale_matching_combinations} == {
        "trial_stale_cap_a",
        "trial_stale_cap_b",
    }

    mixed_projection_trials = stale_saturated_trials + [
        {
            **trials[1],
            "id": "trial_distinct_projection",
            "trial_index": 13,
            "metrics": {
                **trials[1]["metrics"],
                "annualized_return": trials[1]["metrics"]["annualized_return"] + 0.02,
                "multi_factor_projection_effect": 0.24,
            },
            "score": 99.0,
        }
    ]
    mixed_matching_combinations = service._build_optimization_matching_combination_candidates(
        strategy=strategy_detail,
        payload=optimization_payload,
        trials=mixed_projection_trials,
    )
    assert len(mixed_matching_combinations) == 3
    assert {candidate["id"] for candidate in mixed_matching_combinations[:2]} == {
        "trial_stale_cap_a",
        "trial_distinct_projection",
    }
    assert mixed_matching_combinations[-1]["id"] == "trial_stale_cap_b"


def test_multi_factor_optimization_trial_prefers_projection_over_prepared_context(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    service = client.app.state.service
    strategy = {
        "id": "strat_multi_factor_prepared_context",
        "strategy_type": "MULTI_FACTOR",
        "parameters": {
            "strategy_type": "MULTI_FACTOR",
            "factor_ids": ["s_mom_12m1m_rank", "s_val_ep_ltm_raw"],
            "weights": {"s_mom_12m1m_rank": 60, "s_val_ep_ltm_raw": 40},
            "top_n": 10,
        },
    }
    evaluation_request = {"source_run_id": "run_multi_factor_source"}
    payload = {"objective": "return_sharpe", "source_run_id": "run_multi_factor_source"}
    prepared_context = {"prepared": True}

    def fake_projection(
        _strategy,
        _evaluation_request,
        _payload,
        parameter_snapshot,
    ):
        return {
            "parameter_snapshot": dict(parameter_snapshot),
            "metrics": {
                "return_sharpe": 2.5,
                "out_of_sample_sharpe": 2.1,
                "annualized_return": 0.32,
                "total_return_pct": 44.0,
                "stability": 88.0,
                "multi_factor_projection_effect": 0.08,
            },
            "chart_series": [
                {
                    "trade_date": "2024-01-02",
                    "strategy_return": 0.01,
                    "drawdown": 0.0,
                    "is_oos": False,
                },
            ],
            "score": 2.5,
        }

    def fail_preview_and_chart(*_args, **_kwargs):
        raise AssertionError("projectable multi-factor optimization should not execute a full trial simulation")

    monkeypatch.setattr(service, "_project_multi_factor_optimization_trial", fake_projection)
    monkeypatch.setattr(
        service,
        "_build_optimization_trial_preview_and_chart_series",
        fail_preview_and_chart,
    )

    trial = service._evaluate_optimization_trial(
        strategy,
        evaluation_request,
        payload,
        {
            "factor_weight__s_mom_12m1m_rank_pct": 55,
            "factor_weight__s_val_ep_ltm_raw_pct": 45,
            "top_n": 25,
        },
        prepared_context=prepared_context,
    )

    assert trial["parameter_snapshot"]["top_n"] == 25
    assert trial["parameter_snapshot"]["weights"]["s_mom_12m1m_rank"] == 55
    assert trial["parameter_snapshot"]["weights"]["s_val_ep_ltm_raw"] == 45
    assert trial["metrics"]["return_sharpe"] == 2.5
    assert trial["metrics"]["multi_factor_projection_effect"] == 0.08


def test_multi_factor_top_trial_backfill_uses_projection_chart_without_full_simulation(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    service = client.app.state.service
    strategy = {
        "id": "strat_multi_factor_projection_backfill",
        "strategy_type": "MULTI_FACTOR",
        "parameters": {
            "strategy_type": "MULTI_FACTOR",
            "factor_ids": ["s_mom_12m1m_rank", "s_val_ep_ltm_raw"],
            "weights": {"s_mom_12m1m_rank": 60, "s_val_ep_ltm_raw": 40},
            "top_n": 10,
        },
    }
    payload = {"objective": "return_sharpe", "source_run_id": "run_multi_factor_source"}
    evaluation_request = {"source_run_id": "run_multi_factor_source"}
    trials = [
        {
            "trial_index": 1,
            "status": "SUCCEEDED",
            "parameter_snapshot": {
                "factor_weight__s_mom_12m1m_rank_pct": 55,
                "factor_weight__s_val_ep_ltm_raw_pct": 45,
                "top_n": 25,
            },
            "metrics": {"return_sharpe": 1.2, "out_of_sample_sharpe": 1.0},
            "score": 1.2,
            "started_at": "2026-05-15T00:00:00Z",
            "completed_at": "2026-05-15T00:00:01Z",
        }
    ]
    persisted: dict[str, object] = {}

    def fake_projection(
        _strategy,
        _evaluation_request,
        _payload,
        parameter_snapshot,
    ):
        return {
            "parameter_snapshot": dict(parameter_snapshot),
            "metrics": {
                "return_sharpe": 2.4,
                "out_of_sample_sharpe": 2.0,
                "annualized_return": 0.3,
                "total_return_pct": 42.0,
                "stability": 87.0,
                "multi_factor_projection_effect": 0.07,
            },
            "chart_series": [
                {
                    "trade_date": "2024-01-02",
                    "strategy_return": 0.01,
                    "drawdown": 0.0,
                    "is_oos": False,
                },
            ],
            "score": 2.4,
        }

    def fail_preview_and_chart(*_args, **_kwargs):
        raise AssertionError("top-trial chart backfill should reuse projected chart series")

    def capture_persist(*_args, **kwargs):
        persisted["chart_series"] = list(kwargs.get("chart_series") or [])
        persisted["metrics"] = dict(kwargs.get("metrics") or {})

    monkeypatch.setattr(service, "_load_optimization_trial_chart_series_map", lambda *_args, **_kwargs: {})
    monkeypatch.setattr(service, "_project_multi_factor_optimization_trial", fake_projection)
    monkeypatch.setattr(service, "_build_optimization_trial_preview_and_chart_series", fail_preview_and_chart)
    monkeypatch.setattr(service, "_persist_optimization_trial", capture_persist)

    final_trials = service._backfill_optimization_top_trial_chart_series(
        "opt_projection_backfill",
        strategy,
        evaluation_request,
        payload,
        trials,
    )

    assert final_trials[0]["metrics"]["return_sharpe"] == 2.4
    assert final_trials[0]["metrics"]["multi_factor_projection_effect"] == 0.07
    assert final_trials[0]["chart_series"]
    assert persisted["chart_series"]
    assert persisted["metrics"]["multi_factor_projection_effect"] == 0.07


def test_multi_factor_optimization_runner_skips_prepared_context_for_projected_trials(tmp_path, monkeypatch) -> None:
    client, _db_path = create_test_client(tmp_path)
    service = client.app.state.service
    strategy = {
        "id": "strat_multi_factor_runner_prepared_context",
        "strategy_type": "MULTI_FACTOR",
        "name": "Prepared-context runner",
        "parameters": {
            "strategy_type": "MULTI_FACTOR",
            "factor_ids": ["s_mom_12m1m_rank", "s_val_ep_ltm_raw"],
            "weights": {"s_mom_12m1m_rank": 60, "s_val_ep_ltm_raw": 40},
            "top_n": 10,
        },
    }
    payload = {
        "objective": "return_sharpe",
        "source_run_id": "run_prepared_context_source",
        "budget_combinations": 2,
        "search_space": [
            {"key": "top_n", "label": "持仓数量", "mode": "range", "start": 5, "end": 10, "step": 5},
        ],
    }
    planned_snapshots = [
        {**strategy["parameters"], "top_n": 5},
        {**strategy["parameters"], "top_n": 10},
    ]
    captured: dict[str, object] = {}

    monkeypatch.setattr(service, "get_strategy_detail", lambda _strategy_id: strategy)
    monkeypatch.setattr(service, "_normalize_optimization_search_space", lambda _strategy, request: request["search_space"])
    monkeypatch.setattr(service, "_optimization_base_snapshot", lambda _strategy, _request: (planned_snapshots[0], {"id": "run_prepared_context_source"}))
    monkeypatch.setattr(service, "_plan_optimization_search_snapshots", lambda _base, _space, _budget: planned_snapshots)
    monkeypatch.setattr(service, "_build_optimization_evaluation_request", lambda _strategy, source_run=None: {"source_run_id": source_run["id"]})
    monkeypatch.setattr(service, "_ensure_optimization_snapshots_ready", lambda **_kwargs: None)
    monkeypatch.setattr(service, "_refresh_optimization_runner_claim", lambda _job_id: True)
    monkeypatch.setattr(service, "_load_optimization_trials", lambda *_args, **_kwargs: [])
    def fail_prepare_context(*_args, **_kwargs):
        raise AssertionError("projected optimization should not preload prepared context")

    monkeypatch.setattr(service, "_prepare_backtest_run_context", fail_prepare_context)
    monkeypatch.setattr(service, "_persist_optimization_job", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_optimization_runtime_best_summary", lambda _state: None)
    monkeypatch.setattr(
        service,
        "_best_optimization_trial_summary",
        lambda _trials, _objective=None: {
            "trial_index": 1,
            "label": "Trial 1",
            "status": "SUCCEEDED",
            "parameter_snapshot": planned_snapshots[0],
            "metrics": {"return_sharpe": 1.1},
            "score": 1.1,
        },
    )
    monkeypatch.setattr(service, "_build_optimization_candidates_from_trial_pool", lambda **kwargs: ([], list(kwargs.get("trials") or [])))
    monkeypatch.setattr(service, "_build_optimization_matching_combination_candidates", lambda **_kwargs: [])

    def fake_sequential(**kwargs):
        captured["sequential_prepared_context"] = kwargs.get("prepared_context")
        return {
            1: service._optimization_trial_record(
                job_id=kwargs["job_id"],
                trial_index=1,
                status="SUCCEEDED",
                parameter_snapshot=planned_snapshots[0],
                metrics={"annualized_return": 0.11, "return_sharpe": 1.1},
                score=1.1,
                error_message=None,
                started_at="2026-05-15T00:00:00Z",
                completed_at="2026-05-15T00:00:01Z",
            ),
            2: service._optimization_trial_record(
                job_id=kwargs["job_id"],
                trial_index=2,
                status="SUCCEEDED",
                parameter_snapshot=planned_snapshots[1],
                metrics={"annualized_return": 0.12, "return_sharpe": 1.2},
                score=1.2,
                error_message=None,
                started_at="2026-05-15T00:00:01Z",
                completed_at="2026-05-15T00:00:02Z",
            ),
        }, 0

    def fake_backfill(_job_id, _strategy, _evaluation_request, _payload, trials, *, prepared_context=None):
        captured["backfill_prepared_context"] = prepared_context
        return list(trials)

    monkeypatch.setattr(service, "_run_sequential_optimization_trials", fake_sequential)
    monkeypatch.setattr(service, "_backfill_optimization_top_trial_chart_series", fake_backfill)

    service._run_real_optimization_job(
        "opt_prepared_context_runner",
        strategy["id"],
        payload,
        created_at="2026-05-15T00:00:00Z",
    )

    assert captured["sequential_prepared_context"] is None
    assert captured["backfill_prepared_context"] is None


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

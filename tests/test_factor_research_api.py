from __future__ import annotations

import json
import sqlite3

from datetime import date, timedelta

from grit_backtest_platform import _real_service_rebuilt as real_service_module
from grit_backtest_platform.factor_research import (
    VALUE_VOL_WNZT_F3_EXPRESSION,
    VALUE_VOL_WNZT_F3_FACTOR_ID,
    VALUE_VOL_WNZT_F3_FACTOR_NAME,
    VALUE_VOL_WNZT_F3_PARENTS,
    factor_display_name_projection_v4,
    validate_factor_expression,
)
from grit_backtest_platform.storage import dumps
from tests.api_test_support import assert_ok, create_test_client


def _business_days(start: date, count: int) -> list[date]:
    days: list[date] = []
    cursor = start
    while len(days) < count:
        if cursor.weekday() < 5:
            days.append(cursor)
        cursor += timedelta(days=1)
    return days


def seed_ready_pit_data(client, *, start: date = date(2014, 1, 2), day_count: int = 3200, oscillating: bool = False) -> None:
    service = client.app.state.service
    repository = service.market_data_repository
    symbols = ["AAPL", "MSFT", "NVDA", "AMZN"]
    days = _business_days(start, day_count)
    price_bars = []
    coverage = []
    for symbol_index, symbol in enumerate(symbols):
        price = 100.0 + symbol_index * 9.0
        drift = 0.0006 + symbol_index * 0.0002
        for day_index, current_day in enumerate(days):
            if oscillating:
                cycle = (0.006, -0.004, 0.003, -0.005, 0.007, -0.002, 0.001)
                price = round(max(1.0, price * (1.0 + drift + cycle[day_index % len(cycle)])), 4)
            else:
                price = round(price * (1.0 + drift + (day_index % 7) * 0.00005), 4)
            price_bars.append(
                {
                    "symbol": symbol,
                    "date": current_day.isoformat(),
                    "open": price * 0.998,
                    "high": price * 1.003,
                    "low": price * 0.997,
                    "close": price,
                    "adj_close": price,
                    "volume": 1_000_000 + day_index * 1000,
                    "source": "unit_test",
                    "fallback_source": "none",
                }
            )
        coverage.append(
            {
                "symbol": symbol,
                "start_date": days[0].isoformat(),
                "end_date": days[-1].isoformat(),
                "trade_days": len(days),
                "source": "unit_test",
                "fallback_source": "none",
                "metadata": {"coverage_kind": "price_daily"},
            }
        )
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "股票价格数据",
            "status": "READY",
            "as_of": days[-1].isoformat(),
            "freshness_label": "单元测试 PIT 快照",
            "start_date": days[0].isoformat(),
            "end_date": days[-1].isoformat(),
            "row_count": len(price_bars),
            "source": "unit_test",
            "fallback_source": "none",
            "metadata": {
                "covered_symbol_count": len(symbols),
                "total_symbol_count": len(symbols),
            },
        },
        price_bars=price_bars,
        symbol_coverage=coverage,
    )
    repository.replace_dataset_snapshot(
        {
            "id": "ds-corporate-actions",
            "name": "公司行为数据",
            "status": "READY",
            "as_of": days[-1].isoformat(),
            "freshness_label": "单元测试公司行为快照",
            "start_date": days[0].isoformat(),
            "end_date": days[-1].isoformat(),
            "row_count": 0,
            "source": "unit_test",
            "fallback_source": "none",
        },
        corporate_actions=[],
    )
    repository.replace_universe_snapshot(
        {
            "id": "un-sp500",
            "universe_key": "SP500",
            "name": "标普500",
            "status": "READY",
            "as_of": days[-1].isoformat(),
            "freshness_label": "单元测试历史锚点",
            "window_start": days[0].isoformat(),
            "window_end": days[-1].isoformat(),
            "anchor_schedule": "01-01 / 07-01",
            "member_count": len(symbols),
            "source": "unit_test_revision",
            "fallback_source": "none",
            "metadata": {"coverage_mode": "point_in_time_anchor"},
        },
        memberships=[
            {
                "effective_date": days[0].isoformat(),
                "symbol": symbol,
                "source": "unit_test_revision",
                "fallback_source": "none",
                "metadata": {"source_quality": "historical_revision_snapshot"},
            }
            for symbol in symbols
        ],
    )
    if hasattr(service, "_invalidate_pit_data_overview_cache"):
        service._invalidate_pit_data_overview_cache()


def replace_default_universe_with_current_membership(client, *, as_of: str) -> None:
    service = client.app.state.service
    repository = service.market_data_repository
    symbols = ["AAPL", "MSFT", "NVDA", "AMZN"]
    repository.replace_universe_snapshot(
        {
            "id": "un-sp500",
            "universe_key": "SP500",
            "name": "标普500",
            "status": "READY",
            "as_of": as_of,
            "freshness_label": "单元测试当前成分",
            "window_start": as_of,
            "window_end": as_of,
            "anchor_schedule": "current",
            "member_count": len(symbols),
            "source": "wikipedia_current_page",
            "fallback_source": "current_page",
            "metadata": {"coverage_mode": "current_constituents"},
        },
        memberships=[
            {
                "effective_date": as_of,
                "symbol": symbol,
                "source": "wikipedia_current_page",
                "fallback_source": "current_page",
                "metadata": {"source_quality": "current_page"},
            }
            for symbol in symbols
        ],
    )
    if hasattr(service, "_invalidate_pit_data_overview_cache"):
        service._invalidate_pit_data_overview_cache()


def mark_price_snapshot_incomplete(
    client,
    *,
    missing_symbols: list[str],
    provider_summary: dict | None = None,
) -> None:
    service = client.app.state.service
    repository = service.market_data_repository
    metadata = {
        "covered_symbol_count": 4,
        "total_symbol_count": 4 + len(missing_symbols),
        "missing_symbols": missing_symbols,
    }
    if provider_summary is not None:
        metadata["provider_summary"] = provider_summary
    with repository.connect() as conn:
        conn.execute(
            """
            UPDATE dataset_snapshots
            SET status = 'INCOMPLETE',
                metadata_json = ?,
                updated_at = ?
            WHERE id = 'ds-price'
            """,
            (dumps(metadata), f"{date.today().isoformat()}T00:00:00Z"),
        )
    if hasattr(service, "_invalidate_pit_data_overview_cache"):
        service._invalidate_pit_data_overview_cache()


def seed_partial_fundamental_snapshot(client) -> None:
    service = client.app.state.service
    repository = service.market_data_repository
    fields = ["ltm_earnings", "revenue", "market_cap"]
    repository.replace_fundamental_snapshot(
        {
            "id": "ds-fundamentals",
            "name": "基础面 PIT 数据",
            "status": "READY",
            "as_of": "2026-04-01",
            "freshness_label": "unit-test partial fundamentals",
            "start_date": "2025-12-31",
            "end_date": "2025-12-31",
            "row_count": 1,
            "source": "unit_test",
            "fallback_source": "none",
            "metadata": {
                "covered_symbol_count": 1,
                "total_symbol_count": 4,
                "available_fields": fields,
            },
        },
        fundamental_points=[
            {
                "symbol": "AAPL",
                "date": "2025-12-31",
                "period_end_date": "2025-12-31",
                "publish_date": "2026-02-15",
                "available_at": "2026-02-15",
                "ltm_earnings": 10.0,
                "revenue": 100.0,
                "market_cap": 2_000_000.0,
            }
        ],
        fundamental_coverage=[
            {
                "symbol": "AAPL",
                "start_date": "2025-12-31",
                "end_date": "2025-12-31",
                "observation_count": 1,
                "fields": fields,
            }
        ],
    )
    if hasattr(service, "_invalidate_pit_data_overview_cache"):
        service._invalidate_pit_data_overview_cache()


def seed_ready_signal_snapshot(client, dataset_id: str, *, point_count: int = 1, total_symbol_count: int | None = None) -> None:
    service = client.app.state.service
    repository = service.market_data_repository
    entities = [f"SERIES{i:02d}" for i in range(point_count)]
    if dataset_id == "ds-short-volume":
        entities = ["AAPL", "MSFT", "NVDA", "AMZN"][: max(1, min(point_count, 4))]
    repository.replace_signal_snapshot(
        {
            "id": dataset_id,
            "name": dataset_id,
            "status": "READY",
            "as_of": "2026-04-01",
            "freshness_label": "unit-test signal",
            "start_date": "2026-03-01",
            "end_date": "2026-04-01",
            "row_count": len(entities),
            "source": "unit_test",
            "fallback_source": "none",
            "metadata": {
                "pit_gate_status": "READY",
                "covered_symbol_count": len(entities),
                "total_symbol_count": total_symbol_count or len(entities),
            },
        },
        signal_points=[
            {
                "entity_key": entity,
                "date": "2026-04-01",
                "publish_date": "2026-04-01",
                "available_at": "2026-04-01",
                "metric_key": "sample_value",
                "metric_value": 1.0 + index,
                "source": "unit_test",
            }
            for index, entity in enumerate(entities)
        ],
        signal_coverage=[
            {
                "entity_key": entity,
                "start_date": "2026-04-01",
                "end_date": "2026-04-01",
                "observation_count": 1,
                "source": "unit_test",
            }
            for entity in entities
        ],
    )
    if hasattr(service, "_invalidate_pit_data_overview_cache"):
        service._invalidate_pit_data_overview_cache()


def seed_factor_diagnostic_summary(client, factor_id: str, summary: dict, *, run_id: str | None = None) -> None:
    service = client.app.state.service
    now = "2026-05-08T09:30:00Z"
    diagnostic_run_id = run_id or f"fdiag_{factor_id}_unit"
    summary_payload = {**summary, "run_id": diagnostic_run_id, "factor_id": factor_id, "status": summary.get("status", "COMPLETED")}
    with service.storage.connection() as conn:
        conn.execute(
            """
            UPDATE factor_definitions
            SET lifecycle_status = 'VERIFIED',
                diagnostic_status = 'COMPLETED',
                updated_at = ?
            WHERE id = ? AND deleted_at IS NULL
            """,
            (now, factor_id),
        )
        conn.execute(
            """
            INSERT OR REPLACE INTO factor_diagnostic_runs (
                id, factor_id, status, dataset_snapshot_id, universe_snapshot_id,
                request_json, summary_json, artifact_refs_json, created_at, completed_at, error_message
            )
            VALUES (?, ?, 'COMPLETED', 'ds-price', 'un-sp500', '{}', ?, '{}', ?, ?, NULL)
            """,
            (diagnostic_run_id, factor_id, dumps(summary_payload), now, now),
        )


def governance_ready_summary(
    *,
    rank_ic: float = 0.031,
    ir: float = 0.82,
    coverage: float = 96.0,
    inverted: bool = False,
    low_efficiency: bool = False,
) -> dict:
    if inverted:
        group_returns = [
            {"group": "Q1", "mean_return": -0.021, "sample_count": 120},
            {"group": "Q2", "mean_return": -0.011, "sample_count": 120},
            {"group": "Q3", "mean_return": 0.002, "sample_count": 120},
            {"group": "Q4", "mean_return": 0.011, "sample_count": 120},
            {"group": "Q5", "mean_return": 0.024, "sample_count": 120},
        ]
    else:
        group_returns = [
            {"group": "Q1", "mean_return": 0.041, "sample_count": 120},
            {"group": "Q2", "mean_return": 0.024, "sample_count": 120},
            {"group": "Q3", "mean_return": 0.008, "sample_count": 120},
            {"group": "Q4", "mean_return": -0.004, "sample_count": 120},
            {"group": "Q5", "mean_return": -0.016, "sample_count": 120},
        ]
    series_value = 0.002 if low_efficiency else rank_ic
    return {
        "status": "COMPLETED",
        "diagnostic_mode": "VERIFIED",
        "rank_ic": rank_ic,
        "ic": rank_ic,
        "ir": ir,
        "coverage": coverage,
        "group_returns": group_returns,
        "ic_series": [
            {"date": f"2026-04-{day:02d}", "rank_ic": series_value, "ic": series_value, "symbol_count": 420}
            for day in range(1, 21)
        ],
    }


def governance_ready_summary_with_ic_series(
    *,
    rank_ic: float,
    ir: float,
    coverage: float,
    values: list[float],
) -> dict:
    summary = governance_ready_summary(rank_ic=rank_ic, ir=ir, coverage=coverage)
    summary["ic_series"] = [
        {"date": f"2026-04-{index + 1:02d}", "rank_ic": value, "ic": value, "symbol_count": 420}
        for index, value in enumerate(values)
    ]
    return summary


def inverted_group_return_series() -> list[dict]:
    values = [
        ("2026-01-31", -0.010, -0.002, 0.004, 0.014, 0.022),
        ("2026-02-28", -0.012, -0.003, 0.003, 0.013, 0.023),
        ("2026-03-31", -0.011, -0.002, 0.004, 0.014, 0.024),
        ("2026-04-30", -0.013, -0.004, 0.003, 0.015, 0.025),
        ("2026-05-31", -0.009, -0.001, 0.005, 0.016, 0.026),
    ]
    series: list[dict] = []
    for row in values:
        groups = [
            {"group": f"Q{index}", "mean_return": mean_return, "sample_count": 120}
            for index, mean_return in enumerate(row[1:], start=1)
        ]
        series.append(
            {
                "date": row[0],
                "groups": groups,
                "q1_mean_return": groups[0]["mean_return"],
                "q5_mean_return": groups[-1]["mean_return"],
                "q1_q5_spread": groups[0]["mean_return"] - groups[-1]["mean_return"],
            }
        )
    return series


def mark_corporate_actions_snapshot_incomplete(client, *, missing_symbols: list[str]) -> None:
    repository = client.app.state.service.market_data_repository
    metadata = {
        "covered_symbol_count": 4,
        "total_symbol_count": 4 + len(missing_symbols),
        "missing_symbols": missing_symbols,
    }
    with repository.connect() as conn:
        conn.execute(
            """
            UPDATE dataset_snapshots
            SET status = 'INCOMPLETE',
                metadata_json = ?,
                updated_at = ?
            WHERE id = 'ds-corporate-actions'
            """,
            (dumps(metadata), f"{date.today().isoformat()}T00:00:00Z"),
        )


def mark_fundamental_snapshot_incomplete(client) -> None:
    repository = client.app.state.service.market_data_repository
    metadata = {
        "covered_symbol_count": 0,
        "total_symbol_count": 4,
        "available_fields": [],
    }
    with repository.connect() as conn:
        conn.execute(
            """
            UPDATE dataset_snapshots
            SET status = 'INCOMPLETE',
                metadata_json = ?,
                updated_at = ?
            WHERE id = 'ds-fundamentals'
            """,
            (dumps(metadata), f"{date.today().isoformat()}T00:00:00Z"),
        )


def seed_current_only_universe(client, *, universe_snapshot_id: str, as_of: str) -> None:
    repository = client.app.state.service.market_data_repository
    symbols = ["AAPL", "MSFT", "NVDA", "AMZN"]
    repository.replace_universe_snapshot(
        {
            "id": universe_snapshot_id,
            "universe_key": "SP500_CURRENT",
            "name": "标普500当前成分",
            "status": "READY",
            "as_of": as_of,
            "freshness_label": "单元测试当前成分",
            "window_start": as_of,
            "window_end": as_of,
            "anchor_schedule": "current",
            "member_count": len(symbols),
            "source": "wikipedia_current_page",
            "fallback_source": "current_page",
            "metadata": {"coverage_mode": "current_constituents"},
        },
        memberships=[
            {
                "effective_date": as_of,
                "symbol": symbol,
                "source": "wikipedia_current_page",
                "fallback_source": "current_page",
                "metadata": {"source_quality": "current_page"},
            }
            for symbol in symbols
        ],
    )


def manual_descriptor(*, category: str = "mom", metric: str = "short", window: str = "5d", operator: str = "rank") -> dict[str, str]:
    return {
        "source_prefix": "m",
        "category": category,
        "metric": metric,
        "window": window,
        "operator": operator,
    }


def clear_fundamental_snapshot(client) -> None:
    repository = client.app.state.service.market_data_repository
    repository.replace_fundamental_snapshot(
        {
            "id": "ds-fundamentals",
            "name": "基础面 PIT 空快照",
            "status": "INCOMPLETE",
            "as_of": date.today().isoformat(),
            "freshness_label": "单元测试空基础面",
            "row_count": 0,
            "source": "unit_test",
            "fallback_source": "none",
            "metadata": {"available_fields": []},
        },
        fundamental_points=[],
        fundamental_coverage=[],
    )


def test_pit_data_overview_requires_dataset_and_universe_snapshots(tmp_path):
    client, _db_path = create_test_client(tmp_path)

    empty_payload = assert_ok(client.get("/pit-data"))
    assert empty_payload["dataset_snapshot_id"] == "ds-price"
    assert empty_payload["universe_snapshot_id"] == "un-sp500"
    assert empty_payload["overall_status"] == "BLOCKED"
    assert empty_payload["blocking_items"]

    seed_ready_pit_data(client)

    ready_payload = assert_ok(client.get("/pit-data"))
    assert ready_payload["overall_status"] == "READY"
    assert ready_payload["factor_diagnostics_enabled"] is True
    assert ready_payload["verified_diagnostics_enabled"] is True
    assert ready_payload["sandbox_diagnostics_enabled"] is True
    assert ready_payload["coverage"]["covered_symbol_count"] == 4
    assert ready_payload["fundamental_snapshot_id"] == "ds-fundamentals"
    assert ready_payload["fundamental_status"] == "READY"
    assert ready_payload["fundamental_coverage"]["missing_fields"] == []
    assert ready_payload["full_ready_repair_plan"]["status"] == "READY"
    assert ready_payload["full_ready_repair_plan"]["queue_total_count"] == 0
    assert [item["layer_id"] for item in ready_payload["pit_layer_readiness"]] == [
        "l1_market_data",
        "l2_fundamental_data",
        "l3_sentiment_data",
        "l4_macro_derivatives",
    ]
    l1_layer = next(item for item in ready_payload["pit_layer_readiness"] if item["layer_id"] == "l1_market_data")
    l1_metrics = {item["label"]: item["value"] for item in l1_layer["metrics"]}
    assert l1_metrics["PIT目标"] == "4/4"
    assert l1_metrics["基准ETF"] == "0/3"
    by_group = {item["group_id"]: item for item in ready_payload["factor_diagnostic_readiness"]}
    assert by_group["price"]["status"] == "VERIFIED"
    assert by_group["quality_valuation"]["status"] == "VERIFIED"
    assert by_group["sentiment_micro"]["status"] == "DISABLED"
    assert by_group["macro_derivatives"]["status"] in {"SANDBOX", "VERIFIED"}
    linkage = {item["check_id"]: item for item in ready_payload["snapshot_layer_linkage"]}
    assert linkage["fundamental_publish_gate"]["target_factor_groups"]
    assert linkage["rate_beta_calibration"]["result_status"] in {"CALIBRATING", "READY"}
    assert any(item["code"] == "RATE_BETA_CALIBRATING" for item in ready_payload["pit_quality_alerts"])
    trust_summary = ready_payload["data_trust_summary"]
    assert trust_summary["summary_label"] == "数据可信层"
    assert {item["id"] for item in trust_summary["layers"]} >= {
        "price_primary_chain",
        "membership_history",
        "delisted_identity",
        "corporate_actions_zero_event",
    }


def test_pit_data_overview_uses_sql_summary_without_full_membership_hydration(tmp_path, monkeypatch):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    service = client.app.state.service
    service._invalidate_pit_data_overview_cache()

    def fail_full_membership_hydration(**_kwargs):
        raise AssertionError("/pit-data must not hydrate full universe membership snapshots for first paint")

    monkeypatch.setattr(service.market_data_repository, "load_universe_memberships", fail_full_membership_hydration)

    payload = assert_ok(client.get("/pit-data"))

    assert payload["overall_status"] == "READY"
    assert payload["coverage"]["universe_member_rows"] == 4
    assert payload["source"]["historical_universe_member_rows"] == 4


def test_pit_data_overview_cache_hit_skips_snapshot_signature_scan(tmp_path, monkeypatch):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    service = client.app.state.service
    service._invalidate_pit_data_overview_cache()

    first_payload = assert_ok(client.get("/pit-data"))
    assert first_payload["overall_status"] == "READY"

    def fail_signature_scan():
        raise AssertionError("/pit-data cache hits must not rescan market snapshot tables")

    monkeypatch.setattr(service, "_market_data_snapshot_cache_signature", fail_signature_scan)

    cached_payload = assert_ok(client.get("/pit-data"))

    assert cached_payload["overall_status"] == "READY"
    assert cached_payload["coverage"]["covered_symbol_count"] == first_payload["coverage"]["covered_symbol_count"]


def test_pit_data_overview_build_does_not_hold_pit_cache_lock(tmp_path, monkeypatch):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    service = client.app.state.service
    service._invalidate_pit_data_overview_cache()
    original_builder = real_service_module.build_pit_data_overview

    def lock_checking_builder(repository):
        acquired = service._pit_data_overview_cache_lock.acquire(blocking=False)
        try:
            assert acquired, "/pit-data must not hold the PIT cache lock while rebuilding"
            return original_builder(repository)
        finally:
            if acquired:
                service._pit_data_overview_cache_lock.release()

    monkeypatch.setattr(real_service_module, "build_pit_data_overview", lock_checking_builder)

    payload = assert_ok(client.get("/pit-data"))

    assert payload["overall_status"] == "READY"


def test_pit_data_overview_exposes_gap_preview_history_and_action_targets(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    mark_price_snapshot_incomplete(client, missing_symbols=["AAPL", "ZZZZ"])

    payload = assert_ok(client.get("/pit-data"))

    assert payload["overall_status"] == "BLOCKED"
    assert payload["coverage_gap"]["missing_symbol_count"] == 2
    assert payload["status_reasons"]["adjusted_price"]["description"]
    assert payload["status_reasons"]["outlier_cleaning"]["description"]
    assert payload["ops_guidance"]["headline"]
    buckets = {item["id"]: item for item in payload["coverage_gap"]["buckets"]}
    assert buckets["current_core_missing"]["count"] == 1
    assert buckets["current_core_missing"]["mcap_weight_pct"] > 0
    assert buckets["current_core_missing"]["temporal_distribution"]
    assert buckets["non_core_missing"]["sample_symbols"] == ["ZZZZ"]
    assert payload["coverage_gap"]["default_ignored_symbols"] == ["ZZZZ"]
    identity_details = {
        detail["symbol"]: detail
        for detail in buckets["identity_unresolved"]["symbol_details"]
    }
    assert identity_details["ZZZZ"]["mapping_action"]["endpoint"] == "/pit-data/identity-overrides"
    assert identity_details["ZZZZ"]["ticker_path"]
    assert {item["id"] for item in payload["cleaning_rule_previews"]} >= {"mad", "sigma", "industry"}
    assert payload["universe_history_series"][-1]["member_count"] == 4
    assert payload["adjustment_trace"]["symbol"] in {"AAPL", "AMZN", "MSFT", "NVDA"}
    assert payload["blocking_items"][0]["code"] == "PRICE_SNAPSHOT_NOT_READY"
    assert payload["blocking_items"][0]["fix_hash"] == "#/snapshots?tab=equity&target=ds-price"
    repair_plan = payload["full_ready_repair_plan"]
    assert repair_plan["status"] == "NEEDS_REPAIR"
    assert repair_plan["target_status"] == "FULL_READY"
    assert repair_plan["remaining_symbol_count"] == 2
    assert repair_plan["queue_symbols"] == ["AAPL", "ZZZZ"]
    assert repair_plan["queue_price_symbols"] == ["AAPL", "ZZZZ"]
    assert repair_plan["queue_corporate_action_symbols"] == []
    repair_by_symbol = {item["symbol"]: item for item in repair_plan["queue_sample"]}
    assert repair_by_symbol["AAPL"]["bucket"] == "current_core_missing"
    assert repair_by_symbol["AAPL"]["priority"] == 10
    assert repair_by_symbol["AAPL"]["next_provider"] == "tiingo"
    assert repair_by_symbol["AAPL"]["provider_priority"][:3] == ["tiingo", "fmp", "stooq"]
    assert "可审计 EOD OHLCV 入库记录" in repair_by_symbol["AAPL"]["required_evidence"]
    assert repair_by_symbol["AAPL"]["trust_blocker"] == "身份/生命周期未闭合，SEC/CIK 或 FMP/Tiingo alias 证据缺失。"
    assert repair_by_symbol["ZZZZ"]["bucket"] == "non_core_missing"
    assert "yahoo" in repair_by_symbol["ZZZZ"]["price_providers"]
    assert repair_plan["rejection_criteria"]

    mapped_payload = assert_ok(
        client.post(
            "/pit-data/identity-overrides",
            json={
                "symbol": "ZZZZ",
                "canonical_symbol": "ZZZ",
                "company_name": "ZZZ Legacy Corp",
                "valid_from": "2010-01-01",
                "valid_to": "2012-12-31",
                "reason": "单元测试手动建立 ticker 生命周期映射",
            },
        )
    )
    mapped_buckets = {item["id"]: item for item in mapped_payload["coverage_gap"]["buckets"]}
    assert "ZZZZ" not in mapped_buckets["identity_unresolved"]["sample_symbols"]
    assert mapped_payload["coverage_gap"]["identity_resolved_count"] >= 1


def test_pit_factor_admission_allows_archival_full_ready_gap_without_blocking_10y(tmp_path):
    client, db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    mark_price_snapshot_incomplete(client, missing_symbols=["ZZZZ"])

    payload = assert_ok(client.get("/pit-data"))

    admission = payload["factor_admission_coverage"]
    assert payload["overall_status"] == "BLOCKED"
    assert admission["status"] == "READY"
    assert admission["blocks_factor_admission"] is False
    assert admission["current_core_missing_count"] == 0
    assert admission["active_window_missing_count"] == 0
    assert admission["archival_missing_count"] == 1
    assert payload["factor_diagnostics_enabled"] is True
    assert payload["verified_diagnostics_enabled"] is True
    assert payload["status_reasons"]["factor_admission"]["cause"] == "FACTOR_ADMISSION_10Y_READY"
    l1_layer = next(item for item in payload["pit_layer_readiness"] if item["layer_id"] == "l1_market_data")
    assert l1_layer["status"] != "BLOCKED"
    price_replay = next(item for item in l1_layer["submodules"] if item["id"] == "price_replay")
    assert price_replay["status"] == "READY"
    price_group = next(item for item in payload["factor_diagnostic_readiness"] if item["group_id"] == "price")
    assert price_group["status"] == "VERIFIED"
    linkage = {item["check_id"]: item for item in payload["snapshot_layer_linkage"]}
    assert linkage["price_replay_gate"]["result_status"] == "READY"
    assert linkage["price_replay_gate"]["hard_blocking"] is False
    snapshot_overview = assert_ok(client.get("/data-snapshots/overview"))
    snapshot_layers = {item["layer_id"]: item for item in snapshot_overview["data_layer_readiness"]}
    pit_layers = {item["layer_id"]: item for item in payload["pit_layer_readiness"]}
    assert {
        layer_id: snapshot_layers[layer_id]["status"]
        for layer_id in pit_layers
    } == {
        layer_id: pit_layer["status"]
        for layer_id, pit_layer in pit_layers.items()
    }

    created = assert_ok(
        client.post(
            "/factors",
            json={
                "name": "Volume Concentration",
                "market": "US",
                "universe": "SP500",
                "expression": "Correlation(Volume, Abs(Return(Close,1)),21)",
                "description": "unit regression factor",
                "frequency": "DAILY",
                "direction": "HIGH_IS_BETTER",
                "descriptor": manual_descriptor(category="liq", metric="vol_conc", window="21d", operator="raw"),
                "tags": ["manual", "factor_zoo"],
            },
        )
    )
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE factor_definitions SET diagnostic_status = 'SANDBOX_READY' WHERE id = ?",
            (created["id"],),
        )

    diagnostic = assert_ok(
        client.post(
            f"/factors/{created['id']}/diagnostics",
            json={
                "start_date": payload["diagnostic_windows"]["verified"]["start_date"],
                "end_date": payload["as_of_date"],
                "dataset_snapshot_id": payload["dataset_snapshot_id"],
                "universe_snapshot_id": payload["universe_snapshot_id"],
                "return_window_days": 21,
                "group_count": 5,
                "diagnostic_mode": "VERIFIED",
            },
        )
    )
    assert diagnostic["summary"]["factor_id"] == "m_liq_vol_conc_21d_raw"
    assert diagnostic["summary"]["diagnostic_mode"] == "VERIFIED"
    assert diagnostic["summary"]["coverage"] > 0


def test_pit_factor_admission_surfaces_recomputed_10y_gap_as_repair_warning(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    repository = client.app.state.service.market_data_repository
    repository.replace_universe_snapshot(
        {
            "id": "un-sp500",
            "universe_key": "SP500",
            "name": "S&P 500",
            "status": "READY",
            "as_of": "2026-05-01",
            "freshness_label": "unit historical lifecycle anchors",
            "window_start": "2017-01-01",
            "window_end": "2026-05-01",
            "anchor_schedule": "unit",
            "member_count": 3,
            "source": "unit_test_revision",
            "fallback_source": "none",
            "metadata": {"coverage_mode": "point_in_time_anchor"},
        },
        memberships=[
            {
                "effective_date": "2017-01-01",
                "symbol": "WYND",
                "source": "unit_test_revision",
                "fallback_source": "none",
                "metadata": {"source_quality": "historical_revision_snapshot"},
            },
            {
                "effective_date": "2026-05-01",
                "symbol": "AAPL",
                "source": "unit_test_revision",
                "fallback_source": "none",
                "metadata": {"source_quality": "historical_revision_snapshot"},
            },
            {
                "effective_date": "2026-05-01",
                "symbol": "MSFT",
                "source": "unit_test_revision",
                "fallback_source": "none",
                "metadata": {"source_quality": "historical_revision_snapshot"},
            },
        ],
    )

    payload = assert_ok(client.get("/pit-data"))

    admission = payload["factor_admission_coverage"]
    assert admission["status"] == "REPAIR"
    assert admission["blocks_factor_admission"] is False
    assert admission["current_core_missing_count"] == 0
    assert admission["active_window_missing_symbols"] == ["WYND"]
    assert admission["metadata_mismatch_symbols"] == ["WYND"]
    assert payload["factor_diagnostics_enabled"] is True
    assert payload["limited_diagnostics_enabled"] is True
    assert payload["status_reasons"]["factor_admission"]["cause"] == "FACTOR_ADMISSION_10Y_REPAIR"
    repair_warning = next(
        item for item in admission["warning_items"] if item["code"] == "FACTOR_ADMISSION_10Y_REPAIR"
    )
    assert repair_warning["label"] == "10Y 准入补源队列"
    assert "窗口内活跃标的仍需补齐价格证据或身份映射" in repair_warning["message"]
    assert "factor admission remains allowed" not in repair_warning["message"]


def test_pit_full_ready_repair_plan_prioritizes_nasdaq_wiki_for_historical_price_gaps(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    repository = client.app.state.service.market_data_repository
    repository.replace_universe_snapshot(
        {
            "id": "un-sp500",
            "universe_key": "SP500",
            "name": "S&P 500",
            "status": "READY",
            "as_of": "2026-01-01",
            "freshness_label": "unit historical lifecycle anchors",
            "window_start": "2000-01-01",
            "window_end": "2026-01-01",
            "anchor_schedule": "unit",
            "member_count": 2,
            "source": "unit_test_revision",
            "fallback_source": "none",
            "metadata": {"coverage_mode": "point_in_time_anchor"},
        },
        memberships=[
            {
                "effective_date": "2000-01-01",
                "symbol": "ACE",
                "source": "unit_test_revision",
                "fallback_source": "none",
                "metadata": {"source_quality": "historical_revision_snapshot"},
            },
            {
                "effective_date": "2026-01-01",
                "symbol": "AAPL",
                "source": "unit_test_revision",
                "fallback_source": "none",
                "metadata": {"source_quality": "historical_revision_snapshot"},
            },
        ],
    )
    mark_price_snapshot_incomplete(client, missing_symbols=["ACE"])

    payload = assert_ok(client.get("/pit-data"))
    repair_plan = payload["full_ready_repair_plan"]
    queue_item = repair_plan["queue_sample"][0]

    assert queue_item["bucket"] == "historical_lifecycle_missing"
    assert queue_item["provider_priority"][:4] == ["tiingo", "fmp", "nasdaq_wiki", "stooq"]
    assert queue_item["price_providers"][:4] == ["tiingo", "fmp", "nasdaq_wiki", "stooq"]
    assert "Nasdaq WIKI/Stooq/Kaggle" in repair_plan["free_source_policy"]


def test_pit_full_ready_repair_plan_projects_zero_event_candidates(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    repository = client.app.state.service.market_data_repository
    repository.upsert_symbol_identity(
        {
            "symbol": "AAL",
            "canonical_symbol": "AAL",
            "company_name": "American Airlines Group Inc.",
            "cik": "0000006201",
            "exchange": "NASDAQ",
            "delisting_date": "2013-12-09",
            "source": "sec_edgar",
            "valid_from": "2000-01-01",
            "valid_to": "2013-12-09",
        }
    )
    mark_corporate_actions_snapshot_incomplete(client, missing_symbols=["AAL"])

    payload = assert_ok(client.get("/pit-data"))

    repair_plan = payload["full_ready_repair_plan"]
    assert repair_plan["status"] == "NEEDS_REPAIR"
    assert repair_plan["queue_price_symbols"] == []
    assert repair_plan["queue_corporate_action_symbols"] == ["AAL"]
    queue_item = repair_plan["queue_sample"][0]
    assert queue_item["symbol"] == "AAL"
    assert queue_item["next_provider"] == "tiingo"
    assert "公司行动事件，或明确 zero-event certificate" in queue_item["required_evidence"]
    assert queue_item["trust_blocker"].startswith("公司行动门禁")

    certificates = repair_plan["zero_event_certificates"]
    assert repair_plan["zero_event_certificate_count"] == 1
    assert certificates[0]["symbol"] == "AAL"
    assert certificates[0]["cik"] == "0000006201"
    assert certificates[0]["member_exit_date"] == "2013-12-09"
    assert certificates[0]["last_filing_evidence"]["source"] == "sec_edgar"
    assert certificates[0]["price_action_negative_result"]["provider_priority"][:2] == ["tiingo", "fmp"]
    assert certificates[0]["conclusion"] == "ZERO_EVENT_CANDIDATE"


def test_pit_data_universe_history_series_uses_annual_anchors(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    repository = client.app.state.service.market_data_repository
    memberships = []
    annual_members = [
        ("2014-01-02", ["AAPL", "MSFT"]),
        ("2014-12-31", ["AAPL", "MSFT", "NVDA", "AMZN"]),
        ("2015-06-30", ["AAPL", "MSFT", "NVDA"]),
        ("2015-12-31", ["AAPL", "MSFT", "NVDA", "AMZN"]),
        ("2026-01-14", ["AAPL", "MSFT", "NVDA", "AMZN"]),
    ]
    for effective_date, symbols in annual_members:
        memberships.extend(
            {
                "effective_date": effective_date,
                "symbol": symbol,
                "source": "unit_test_revision",
                "fallback_source": "none",
                "metadata": {"source_quality": "historical_revision_snapshot"},
            }
            for symbol in symbols
        )
    repository.replace_universe_snapshot(
        {
            "id": "un-sp500",
            "universe_key": "SP500",
            "name": "标普500",
            "status": "READY",
            "as_of": "2026-01-14",
            "freshness_label": "单元测试年度历史锚点",
            "window_start": "2014-01-02",
            "window_end": "2026-01-14",
            "anchor_schedule": "annual",
            "member_count": 4,
            "source": "unit_test_revision",
            "fallback_source": "none",
            "metadata": {"coverage_mode": "point_in_time_anchor"},
        },
        memberships=memberships,
    )

    payload = assert_ok(client.get("/pit-data"))
    series = payload["universe_history_series"]

    assert [item["date"] for item in series] == ["2014-12-31", "2015-12-31", "2026-01-14"]
    assert [item["member_count"] for item in series] == [4, 4, 4]
    assert [bool(item.get("is_latest")) for item in series] == [False, False, True]
    assert payload["coverage"]["universe_history_anchor_count"] == 5
    assert payload["coverage"]["universe_history_annual_anchor_count"] == 3
    assert "5 个原始锚点，年度展示 3 个锚点" in payload["status_reasons"]["universe"]["description"]


def test_pit_full_ready_repair_plan_surfaces_provider_cooldown(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    mark_price_snapshot_incomplete(
        client,
        missing_symbols=["ZZZZ"],
        provider_summary={
            "providers": {
                "alpha_vantage": {
                    "quota_limited": True,
                    "next_retry_at": "2999-05-05T00:00:00Z",
                    "reasons": ["free-tier quota or pacing limit exceeded"],
                }
            }
        },
    )

    payload = assert_ok(client.get("/pit-data"))
    repair_plan = payload["full_ready_repair_plan"]

    assert repair_plan["status"] == "NEEDS_REPAIR"
    assert repair_plan["provider_cooldown_count"] == 1
    assert repair_plan["next_retry_at"] == "2999-05-05T00:00:00Z"
    assert repair_plan["queue_sample"][0]["status"] == "WAITING_ON_PROVIDER_COOLDOWN"
    assert repair_plan["waiver_blocks_full_ready"] is False


def test_pit_full_ready_repair_plan_ignores_expired_provider_cooldown(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    mark_price_snapshot_incomplete(
        client,
        missing_symbols=["ZZZZ"],
        provider_summary={
            "providers": {
                "alpha_vantage": {
                    "quota_limited": True,
                    "next_retry_at": "2000-01-01T00:00:00Z",
                    "reasons": ["expired pacing limit"],
                }
            }
        },
    )

    payload = assert_ok(client.get("/pit-data"))
    repair_plan = payload["full_ready_repair_plan"]

    assert repair_plan["provider_cooldown_count"] == 0
    assert repair_plan["next_retry_at"] is None
    assert repair_plan["queue_sample"][0]["status"] == "NEEDS_FREE_SOURCE_REPAIR"


def test_pit_external_source_readiness_tracks_cache_and_optional_credentials(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIT_PIT_BULK_CACHE_DIR", str(tmp_path / "pit-bulk-cache"))
    monkeypatch.delenv("KAGGLE_API_TOKEN", raising=False)
    monkeypatch.delenv("KAGGLE_USERNAME", raising=False)
    monkeypatch.delenv("KAGGLE_KEY", raising=False)
    monkeypatch.delenv("MASSIVE_API_KEY", raising=False)
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    mark_price_snapshot_incomplete(client, missing_symbols=["AAPL", "ZZZZ"])

    payload = assert_ok(client.get("/pit-data"))
    external = payload["external_source_readiness"]

    assert external["kaggle_auth_status"]["credential_status"] == "missing"
    assert external["kaggle_cache_manifest"]["status"] == "MISSING"
    assert external["matrix_coverage_status"]["status"] == "MISSING"
    assert external["parquet_catalog_status"]["status"] == "MISSING"
    assert external["polygon_status"]["credential_status"] == "missing"
    assert "survivorship bias free" in external["source_recommendations"]["search_terms"]
    assert {item["symbol"] for item in external["critical_polygon_candidates"]} >= {"AAPL"}
    assert external["remaining_blockers_by_source"]["kaggle_bulk"]["blocked_targets"]["price"] >= 1


def test_pit_identity_scraper_restart_resolves_pending_identity_symbols(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    mark_price_snapshot_incomplete(client, missing_symbols=["ZZZZ"])

    class UnitIdentityProvider:
        provider_name = "unit_identity_scraper"

        def resolve_identity(self, symbol: str):
            if symbol == "ZZZZ":
                return {
                    "symbol": "ZZZZ",
                    "canonical_symbol": "ZZZ",
                    "company_name": "ZZZ Legacy Corp",
                    "source": self.provider_name,
                    "valid_from": "2010-01-01",
                }
            return None

    client.app.state.service.market_data_provider = UnitIdentityProvider()

    before = assert_ok(client.get("/pit-data"))
    assert before["ops_guidance"]["identity_pending_count"] == 1

    result = assert_ok(
        client.post(
            "/pit-data/identity-scraper/restart",
            json={"reason": "单元测试执行身份映射重启任务", "created_by": "pytest"},
        )
    )

    assert result["status"] == "COMPLETED"
    assert result["attempted_count"] == 1
    assert result["resolved_count"] == 1
    assert result["resolved_symbols"] == ["ZZZZ"]
    assert result["pending_after"] == 0
    buckets = {item["id"]: item for item in result["pit_data"]["coverage_gap"]["buckets"]}
    assert "ZZZZ" not in buckets["identity_unresolved"]["sample_symbols"]


def test_pit_identity_scraper_restart_uses_bulk_identity_and_local_fallback(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    mark_price_snapshot_incomplete(client, missing_symbols=["ZZZZ", "LEGACY"])

    class BulkIdentityProvider:
        provider_name = "unit_bulk_identity_scraper"

        def __init__(self) -> None:
            self.bulk_calls: list[list[str]] = []

        def resolve_identities(self, symbols):
            requested = [str(symbol).strip().upper() for symbol in symbols]
            self.bulk_calls.append(requested)
            return {
                "ZZZZ": {
                    "symbol": "ZZZZ",
                    "canonical_symbol": "ZZZ",
                    "company_name": "ZZZ Legacy Corp",
                    "source": self.provider_name,
                    "valid_from": "2010-01-01",
                }
            }

    provider = BulkIdentityProvider()
    client.app.state.service.market_data_provider = provider

    before = assert_ok(client.get("/pit-data"))
    assert before["ops_guidance"]["identity_pending_count"] == 2

    result = assert_ok(
        client.post(
            "/pit-data/identity-scraper/restart",
            json={"reason": "单元测试执行批量身份映射重启任务", "created_by": "pytest"},
        )
    )

    assert provider.bulk_calls == [["LEGACY", "ZZZZ"]]
    assert result["status"] == "COMPLETED"
    assert result["attempted_count"] == 2
    assert result["resolved_count"] == 2
    assert result["failed_count"] == 0
    assert result["external_resolved_count"] == 1
    assert result["local_fallback_count"] == 1
    assert result["local_fallback_symbols"] == ["LEGACY"]
    assert result["pending_after"] == 0
    buckets = {item["id"]: item for item in result["pit_data"]["coverage_gap"]["buckets"]}
    assert buckets["identity_unresolved"]["sample_symbols"] == []
    assert "Identity Scraper" not in result["pit_data"]["ops_guidance"]["headline"]
    assert all(
        action["target"] != "ops://identity-scraper/restart"
        for action in result["pit_data"]["ops_guidance"]["actions"]
    )

    repository = client.app.state.service.market_data_repository
    fallback = repository.load_symbol_identity("LEGACY")
    assert fallback["canonical_symbol"] == "LEGACY"
    assert fallback["source"] == "pit_identity_local_fallback"


def test_pit_research_waiver_creates_limited_ready_and_excludes_ignored_symbols(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    mark_price_snapshot_incomplete(client, missing_symbols=["ZZZZ"])

    limited = assert_ok(
        client.post(
            "/pit-data/research-waiver",
            json={"reason": "单元测试研究态豁免"},
        )
    )

    assert limited["overall_status"] == "LIMITED_READY"
    assert limited["research_waiver"]["ignored_symbols"] == ["ZZZZ"]
    assert limited["research_waiver"]["promotion_eligible"] is False
    assert limited["research_waiver"]["impact_estimate"]["ignored_symbol_count"] == 1
    assert limited["research_waiver"]["impact_estimate"]["estimated_ic_delta_abs"] >= 0
    assert limited["factor_diagnostics_enabled"] is True
    assert limited["verified_diagnostics_enabled"] is False
    assert limited["limited_diagnostics_enabled"] is True

    diagnostic = assert_ok(
        client.post(
            "/factors/s_mom_12m1m_rank/diagnostics",
            json={
                "start_date": limited["diagnostic_windows"]["verified"]["start_date"],
                "end_date": limited["as_of_date"],
                "dataset_snapshot_id": limited["dataset_snapshot_id"],
                "universe_snapshot_id": limited["universe_snapshot_id"],
                "return_window_days": 21,
                "group_count": 5,
                "diagnostic_mode": "VERIFIED",
            },
        )
    )
    summary = diagnostic["summary"]
    assert summary["pit_readiness_mode"] == "LIMITED_READY"
    assert summary["waiver_id"] == limited["research_waiver"]["id"]
    assert summary["ignored_symbol_count"] == 1
    assert summary["promotion_eligible"] is False
    assert summary["waiver_impact_estimate"]["ignored_symbol_count"] == 1
    assert any("研究态豁免" in item for item in summary["risk_flags"])

    revoked = assert_ok(client.delete(f"/pit-data/research-waiver/{limited['research_waiver']['id']}"))
    assert revoked["overall_status"] == "BLOCKED"
    assert revoked["research_waiver"] is None


def test_pit_data_blocks_current_universe_membership_fallback(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    ready_payload = assert_ok(client.get("/pit-data"))

    replace_default_universe_with_current_membership(client, as_of=ready_payload["as_of_date"])

    blocked_payload = assert_ok(client.get("/pit-data"))
    assert blocked_payload["overall_status"] == "BLOCKED"
    assert blocked_payload["factor_diagnostics_enabled"] is False
    assert blocked_payload["verified_diagnostics_enabled"] is False
    assert blocked_payload["sandbox_diagnostics_enabled"] is True
    assert blocked_payload["coverage"]["universe_member_rows"] == 0
    assert blocked_payload["coverage"]["raw_universe_member_rows"] == 4
    assert blocked_payload["blocking_items"][0]["code"] == "UNIVERSE_HISTORY_BLOCKED"
    assert blocked_payload["diagnostic_windows"]["verified"]["missing_windows"]
    price_group = next(item for item in blocked_payload["factor_diagnostic_readiness"] if item["group_id"] == "price")
    assert price_group["status"] == "BLOCKED"
    linkage = {item["check_id"]: item for item in blocked_payload["snapshot_layer_linkage"]}
    assert linkage["price_replay_gate"]["result_status"] in {"READY", "WARNING"}
    assert linkage["universe_history_gate"]["result_status"] == "BLOCKED"
    assert any(item["code"] == "CURRENT_ONLY_DATA" for item in blocked_payload["pit_quality_alerts"])

    waiver_attempt = assert_ok(
        client.post(
            "/pit-data/research-waiver",
            json={"ignored_symbols": ["ZZZZ"], "reason": "不能把当前成分股兜底伪装成 Full Ready"},
        )
    )
    assert waiver_attempt["overall_status"] == "BLOCKED"
    assert waiver_attempt["verified_diagnostics_enabled"] is False


def test_factor_library_seeds_common_factors_and_resolves_legacy_aliases(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    client.app.state.service._factor_research_service().ensure_default_factors()
    seed_factor_diagnostic_summary(
        client,
        VALUE_VOL_WNZT_F3_FACTOR_ID,
        {
            "rank_ic": 0.0345,
            "ir": 6.91,
            "coverage": 100.0,
            "composition_methods": [{"key": "residual_blend", "label": "Residual Blend"}],
            "group_return_series": [
                {"q1_q5_spread": 0.020},
                {"q1_q5_spread": 0.012},
                {"q1_q5_spread": -0.004},
                {"q1_q5_spread": 0.018},
                {"q1_q5_spread": 0.006},
                {"q1_q5_spread": 0.010},
                {"q1_q5_spread": -0.002},
                {"q1_q5_spread": 0.014},
                {"q1_q5_spread": 0.009},
                {"q1_q5_spread": 0.016},
                {"q1_q5_spread": 0.004},
                {"q1_q5_spread": 0.011},
            ],
            "turnover_decay": {"half_life_days": 252, "annual_turnover_pct": 72.0, "impact_cost_bps": 9.0},
            "scoring_detail": {
                "predictive_power": {"rank_ic": 0.0345, "rank_icir": 6.91},
                "stability_turnover": {"turnover_rate_weekly": 18.0},
                "risk_orthogonality": {"style_corr": 0.26, "incremental_ir": 0.5527, "max_drawdown": 12.34},
                "data_health": {"coverage": 100.0},
            },
        },
    )

    payload = assert_ok(client.get("/factors"))
    ids = {item["id"] for item in payload["items"]}
    canonical_ids = {
        "s_mom_12m1m_rank",
        "s_val_ep_ltm_raw",
        "s_val_bp_latest_raw",
        "s_vol_252d_rank",
        "s_size_cur_log",
        "s_qlty_roe_ltm_raw",
        "s_qlty_fcfy_ttm_raw",
    }
    expanded_seed_ids = {
        "s_price_adjclose_cur_raw",
        "s_beta_market_252d_raw",
        "s_val_cfp_ltm_raw",
        "s_qlty_leverage_cur_raw",
        "s_inv_assetgrowth_1y_rank",
        "s_inv_capex_ltm_raw",
        "s_mom_6m_rank",
        "s_liq_amihud_20d_rank",
        "s_alpha_ffblend_resid_mkt_rank",
        VALUE_VOL_WNZT_F3_FACTOR_ID,
    }
    legacy_ids = {
        "momentum_12m_1m",
        "lowvol_realized_252d",
        "value_ep_ltm",
        "value_bp_latest",
        "quality_roe_ltm",
        "quality_fcf_yield",
        "size_log_market_cap",
        "s_alpha_ffblend_cur_rank",
    }
    assert canonical_ids.issubset(ids)
    assert expanded_seed_ids.issubset(ids)
    assert ids.isdisjoint(legacy_ids)
    assert payload["summary"]["blocked_data_count"] == 0

    by_id = {item["id"]: item for item in payload["items"]}
    assert by_id[VALUE_VOL_WNZT_F3_FACTOR_ID]["name"] == VALUE_VOL_WNZT_F3_FACTOR_NAME
    assert by_id["s_beta_market_252d_raw"]["name"] == "市场 Beta (252d) [Raw]"
    assert by_id["s_val_cfp_ltm_raw"]["name"] == "现金流收益率 (LTM) [Raw]"
    assert by_id["s_alpha_ffblend_resid_mkt_rank"]["name"] == "[综合] - FF3 风格复合基石 (等权) [Beta-Free]"
    assert by_id["s_val_cfp_ltm_raw"]["display_name_cn"] == "现金流收益率 (LTM) [Raw]"
    assert by_id["s_val_cfp_ltm_raw"]["short_name_cn"] == "现金流收益率 (LTM)"
    assert by_id["s_val_cfp_ltm_raw"]["name_schema_version"] == "factor_display_name_v4"
    assert "Raw" in by_id["s_val_cfp_ltm_raw"]["governance_badges"]
    assert "Blend" in by_id["s_alpha_ffblend_resid_mkt_rank"]["governance_badges"]
    assert payload["summary"]["f1_count"] >= 1
    assert payload["summary"]["f2_count"] >= 1
    assert payload["summary"]["f3_count"] >= 1
    assert payload["summary"]["lifecycle_sandbox_count"] >= 0
    assert payload["summary"]["to_be_verified_count"] >= 0
    assert by_id["s_size_mcap_cur_raw"]["tier_level"] == "F1"
    assert by_id["s_size_mcap_cur_raw"]["tier_label"] == "F1 原始"
    assert by_id["s_price_adjclose_cur_raw"]["name"] == "交易所 - 前复权收盘价 (原始)"
    assert by_id["s_price_adjclose_cur_raw"]["tier_level"] == "F1"
    assert by_id["s_val_ep_ltm_raw"]["tier_level"] == "F2"
    assert by_id["s_mom_12m1m_rank"]["tier_level"] == "F2"
    assert by_id["s_alpha_ffblend_resid_mkt_rank"]["tier_level"] == "F3"
    assert by_id["s_alpha_ffblend_resid_mkt_rank"]["tier_label"] == "F3 组合"
    assert by_id["s_alpha_ffblend_resid_mkt_rank"]["descriptor"]["canonical_id"] == "s_alpha_ffblend_resid_mkt_rank"
    assert by_id["s_mom_12m1m_rank"]["lifecycle"] == "online"
    assert by_id["s_mom_12m1m_rank"]["lifecycle_label"] == "线上"
    assert by_id["s_mom_12m1m_rank"]["factor_level"] in {"B", "C"}
    assert by_id["s_mom_12m1m_rank"]["factor_level_label"] in {"B合格", "C微弱"}
    assert "T" in by_id["s_mom_12m1m_rank"]["op_status"]["completed"]
    assert {light["code"] for light in by_id["s_mom_12m1m_rank"]["op_status"]["lights"]} == {"W", "N", "Z", "T"}
    assert by_id["s_alpha_ffblend_resid_mkt_rank"]["op_status"]["completed"] == ["W", "N", "Z", "T"]
    assert by_id["s_alpha_ffblend_resid_mkt_rank"]["op_status"]["missing"] == []
    assert by_id["s_alpha_ffblend_resid_mkt_rank"]["lineage_summary"]["parent_count"] >= 4
    assert by_id["s_alpha_ffblend_resid_mkt_rank"]["lineage_summary"]["has_lineage"] is True
    assert set(by_id["s_alpha_ffblend_resid_mkt_rank"]["lineage_summary"]["parent_ids"]) >= {
        "s_mom_12m1m_rank",
        "s_val_ep_ltm_raw",
        "s_qlty_roe_ltm_raw",
        "s_size_cur_log",
    }
    assert by_id[VALUE_VOL_WNZT_F3_FACTOR_ID]["tier_level"] == "F3"
    assert by_id[VALUE_VOL_WNZT_F3_FACTOR_ID]["op_status"]["completed"] == ["W", "N", "Z", "T"]
    assert by_id[VALUE_VOL_WNZT_F3_FACTOR_ID]["op_status"]["missing"] == []
    assert by_id[VALUE_VOL_WNZT_F3_FACTOR_ID]["lineage_summary"]["has_lineage"] is True
    assert set(by_id[VALUE_VOL_WNZT_F3_FACTOR_ID]["lineage_summary"]["parent_ids"]) == set(VALUE_VOL_WNZT_F3_PARENTS)
    composite_view = by_id[VALUE_VOL_WNZT_F3_FACTOR_ID]["composite_view"]
    assert composite_view["quality"]["sharpe"] is not None
    assert composite_view["quality"]["max_drawdown_pct"] == 12.34
    assert composite_view["turnover_cost"]["turnover_rate_weekly"] == 18.0
    assert composite_view["turnover_cost"]["cost_bps"] == 9.0
    assert composite_view["style_exposure"]["style_corr"] == 0.26
    assert composite_view["source"]["sharpe_source"] == "return_spread_series"
    assert composite_view["source"]["cost_source"] == "turnover_decay"
    assert composite_view["execution"]["portfolio_id"] is None
    assert composite_view["execution"]["portfolio_label"] == "未绑定"
    assert composite_view["blend_info"]["component_count"] == len(VALUE_VOL_WNZT_F3_PARENTS)
    assert set(composite_view["blend_info"]["component_ids"]) == set(VALUE_VOL_WNZT_F3_PARENTS)
    assert composite_view["blend_info"]["method_labels"] == ["Residual Blend"]
    assert by_id["s_size_cur_log"]["lineage_summary"]["parent_ids"] == ["s_size_mcap_cur_raw"]
    assert by_id["s_mom_12m1m_rank"]["lineage_summary"]["parent_ids"] == ["s_price_adjclose_cur_raw"]
    assert set(by_id["s_size_mcap_cur_raw"]["lineage_summary"]["relation_types"]) >= {"DIRECT_SOURCE"}
    assert set(by_id["s_price_adjclose_cur_raw"]["lineage_summary"]["relation_types"]) >= {"DIRECT_SOURCE"}
    quality_view = by_id["s_mom_12m1m_rank"]["quality_view"]
    assert set(quality_view) >= {"rank_ic", "ir", "decay_label", "coverage", "sparkline"}
    for factor_id in canonical_ids:
        assert by_id[factor_id]["diagnostic_status"] == "READY_TO_DIAGNOSE"
        assert by_id[factor_id]["descriptor"]["canonical_id"] == factor_id
        assert by_id[factor_id]["factor_family"]
        assert by_id[factor_id]["formula_version"]
        assert by_id[factor_id]["pit_coverage"]["available_at_gate"] is True
        assert by_id[factor_id]["created_at"]
        assert by_id[factor_id]["updated_at"]
        assert by_id[factor_id]["ui_state"] in {"robust", "needs_calibration", "decayed", "sandbox"}
        assert by_id[factor_id]["ui_state_label"] in {"稳健", "待校准", "失效", "沙箱"}
        assert by_id[factor_id]["batch_diagnostic_summary"]["blocked_count"] == 0
        assert by_id[factor_id]["correlation_cluster_summary"]["high_correlation_count"] >= 0
        assert by_id[factor_id]["blocker_reason_summary"]["status"] in {"clear", "warning", "blocked"}
        assert by_id[factor_id]["strategy_creation_risk"]["can_create"] is True
    first_updated_at = by_id["s_mom_12m1m_rank"]["updated_at"]
    second_payload = assert_ok(client.get("/factors"))
    second_by_id = {item["id"]: item for item in second_payload["items"]}
    assert second_by_id["s_mom_12m1m_rank"]["updated_at"] == first_updated_at
    assert by_id["s_val_ep_ltm_raw"]["descriptor"] == {
        "source_prefix": "s",
        "category": "val",
        "metric": "ep",
        "window": "ltm",
        "operator": "raw",
        "schema_version": "factor_descriptor_v1",
        "canonical_id": "s_val_ep_ltm_raw",
    }

    legacy_detail = assert_ok(client.get("/factors/value_ep_ltm"))
    assert legacy_detail["id"] == "s_val_ep_ltm_raw"
    assert legacy_detail["name"] == "盈利收益率 (LTM) [Raw]"
    assert assert_ok(client.get("/factors/value_bp_latest"))["id"] == "s_val_bp_latest_raw"
    assert assert_ok(client.get("/factors/quality_roe_ltm"))["id"] == "s_qlty_roe_ltm_raw"
    detail = assert_ok(client.get("/factors/s_alpha_ffblend_resid_mkt_rank"))
    assert detail["lineage_tree"]["node"]["id"] == "s_alpha_ffblend_resid_mkt_rank"
    legacy_detail = assert_ok(client.get("/factors/s_alpha_ffblend_cur_rank"))
    assert legacy_detail["id"] == "s_alpha_ffblend_resid_mkt_rank"
    assert detail["lineage_tree"]["parent_count"] >= 4
    assert {parent["id"] for parent in detail["lineage_tree"]["parents"]} >= {
        "s_mom_12m1m_rank",
        "s_val_ep_ltm_raw",
        "s_qlty_roe_ltm_raw",
        "s_size_cur_log",
    }
    assert {parent["label"] for parent in detail["lineage_tree"]["parents"]} >= {
        "截面动量排名 (12-1m) [Rank]",
        "盈利收益率 (LTM) [Raw]",
        "净资产收益率 (LTM) [Raw]",
        "对数市值 (当前) [Raw]",
    }
    momentum_detail = assert_ok(client.get("/factors/s_mom_12m1m_rank"))
    assert momentum_detail["lineage_tree"]["parents"][0]["id"] == "s_price_adjclose_cur_raw"
    assert momentum_detail["lineage_tree"]["parents"][0]["label"] == "交易所 - 前复权收盘价 (原始)"
    assert momentum_detail["lineage_tree"]["parents"][0]["tier_level"] == "F1"


def test_factor_display_name_v4_backfill_dry_run_and_apply_preserves_identity(tmp_path):
    client, db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    assert_ok(client.get("/factors"))
    factor_id = "s_val_cfp_ltm_raw"
    stale_name = "Old Cashflow Name"
    expected_name = "现金流收益率 (LTM) [Raw]"

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        expression_before = conn.execute(
            "SELECT expression FROM factor_versions WHERE factor_id = ? ORDER BY version DESC LIMIT 1",
            (factor_id,),
        ).fetchone()["expression"]
        lineage_before = conn.execute(
            "SELECT COUNT(*) AS count FROM factor_lineage_edges WHERE target_id = ?",
            (factor_id,),
        ).fetchone()["count"]
        conn.execute(
            "UPDATE factor_definitions SET name = ? WHERE id = ?",
            (stale_name, factor_id),
        )

    dry_run = assert_ok(client.post("/factors/display-name-v4-backfill", json={"dry_run": True}))
    dry_item = next(item for item in dry_run["items"] if item["factor_id"] == factor_id)

    assert dry_run["dry_run"] is True
    assert dry_item["previous_display_name"] == stale_name
    assert dry_item["new_display_name"] == expected_name
    assert dry_item["name_schema_version"] == "factor_display_name_v4"
    assert dry_item["rename_reason"] == "display_name_v4_backfill"
    assert "Raw" in dry_item["governance_badges"]

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        assert conn.execute(
            "SELECT name FROM factor_definitions WHERE id = ?",
            (factor_id,),
        ).fetchone()["name"] == stale_name
        assert conn.execute("SELECT COUNT(*) AS count FROM factor_display_name_renames").fetchone()["count"] == 0

    applied = assert_ok(client.post("/factors/display-name-v4-backfill", json={"dry_run": False}))
    applied_item = next(item for item in applied["items"] if item["factor_id"] == factor_id)

    assert applied["dry_run"] is False
    assert applied_item["renamed_at"]
    assert applied["summary"]["applied_count"] >= 1

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        assert conn.execute(
            "SELECT name FROM factor_definitions WHERE id = ?",
            (factor_id,),
        ).fetchone()["name"] == expected_name
        assert conn.execute(
            "SELECT expression FROM factor_versions WHERE factor_id = ? ORDER BY version DESC LIMIT 1",
            (factor_id,),
        ).fetchone()["expression"] == expression_before
        latest_metadata = json.loads(
            conn.execute(
                "SELECT metadata_json FROM factor_versions WHERE factor_id = ? ORDER BY version DESC LIMIT 1",
                (factor_id,),
            ).fetchone()["metadata_json"]
        )
        assert conn.execute(
            "SELECT COUNT(*) AS count FROM factor_lineage_edges WHERE target_id = ?",
            (factor_id,),
        ).fetchone()["count"] == lineage_before
        audit = conn.execute(
            """
            SELECT previous_display_name, new_display_name, name_schema_version, rename_reason
            FROM factor_display_name_renames
            WHERE factor_id = ?
            """,
            (factor_id,),
        ).fetchone()

    assert audit["previous_display_name"] == stale_name
    assert audit["new_display_name"] == expected_name
    assert audit["name_schema_version"] == "factor_display_name_v4"
    assert audit["rename_reason"] == "display_name_v4_backfill"
    assert latest_metadata["publish_metadata"]["display_name_cn"] == expected_name
    assert latest_metadata["publish_metadata"]["base_display_name_cn"] == expected_name
    assert latest_metadata["publish_metadata"]["backfill_reason"] == "display_name_v4_backfill"


def test_factor_display_name_raw_suffix_requires_wnzt_evidence_before_refined_suffix():
    raw_projection = factor_display_name_projection_v4(
        factor_id="a_alpha_custom_cur_raw",
        source="AUTO_MINED",
        expression=VALUE_VOL_WNZT_F3_EXPRESSION,
        tier_level="F3",
    )
    assert raw_projection["display_name_cn"] == "[估值] - 下行风险调节-现金流回报比 (LTM/252d) [Raw]"
    assert raw_projection["name_dedupe_suffix"] == ""
    assert raw_projection["name_audit"]["structured_components"]["governance_tag"] == "Raw"

    refined_projection = factor_display_name_projection_v4(
        factor_id="a_alpha_custom_cur_raw",
        source="AUTO_MINED",
        expression=VALUE_VOL_WNZT_F3_EXPRESSION,
        tier_level="F3",
        op_status={"completed": ["W", "N", "Z", "T"]},
    )
    assert refined_projection["display_name_cn"] == "[估值] - 下行风险调节-现金流回报比 (LTM/252d) [Refined]"
    assert refined_projection["name_audit"]["structured_components"]["governance_tag"] == "Refined"

    middle_raw_projection = factor_display_name_projection_v4(
        factor_id="s_f2_mom_raw_cur_f1_price_open",
        source="AUTO_MINED",
        expression='ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_price_open, 5), 3), method="MAD"), by="industry,market_cap"))',
        tier_level="F2",
        op_status={"completed": ["W", "N", "Z", "T"]},
    )
    assert middle_raw_projection["display_name_cn"] == "平滑收益率 (当前) [Refined]"
    assert middle_raw_projection["name_audit"]["structured_components"]["governance_tag"] == "Refined"


def test_default_factor_repair_uses_wnzt_display_projection_for_middle_raw_auto_factor(tmp_path):
    client, db_path = create_test_client(tmp_path)
    factor_id = "s_f2_mom_raw_cur_f1_price_open"
    expression = 'ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_price_open, 5), 3), method="MAD"), by="industry,market_cap"))'
    now = "2026-05-27T07:30:00Z"

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO factor_definitions (
                id, name, market, universe, source, lifecycle_status, diagnostic_status,
                direction, frequency, expression, tags_json, data_requirements_json,
                institutional_note, created_by, created_at, updated_at
            )
            VALUES (?, 'Legacy Raw Name [Raw]', 'US', 'SP500', 'AUTO_MINED', 'VERIFIED',
                    'COMPLETED', 'HIGH_IS_BETTER', 'DAILY', ?, '[]', '[]', '',
                    'unit_test', ?, ?)
            """,
            (factor_id, expression, now, now),
        )
        conn.execute(
            """
            INSERT INTO factor_versions (id, factor_id, version, expression, status, metadata_json, created_at)
            VALUES (?, ?, 1, ?, 'ACTIVE', '{}', ?)
            """,
            (f"{factor_id}-v1", factor_id, expression, now),
        )

    client.app.state.service._factor_research_service().ensure_default_factors()

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT name FROM factor_definitions WHERE id = ?", (factor_id,)).fetchone()

    assert "[Refined]" in row["name"]
    assert "[Raw]" not in row["name"]


def test_factor_display_name_financial_release_timing_uses_timing_semantic_and_window():
    expression = (
        'TS_Rank(ZScore(Neutralize(Winsorize(Abs(TS_Min(f1_financial_release_timing, 3)), '
        'method="MAD"), by="industry,market_cap")), 3)'
    )
    projection = factor_display_name_projection_v4(
        factor_id="s_f2_mom_raw_cur_f1_financial_release_timing",
        source="AUTO_MINED",
        expression=expression,
        tier_level="F2",
    )
    components = projection["name_audit"]["structured_components"]

    assert projection["display_name_cn"] == "[情绪] - 财报发布时效滞后得分 (3d) [Raw]"
    assert projection["base_display_name_cn"] == "[情绪] - 财报发布时效滞后得分 (3d) [Raw]"
    assert components["style_family"] == "情绪"
    assert components["core_semantic"] == "财报发布时效滞后得分"
    assert components["time_window"] == "3d"
    assert components["governance_tag"] == "Raw"


def test_factor_display_name_v4_backfill_dedupes_online_f2_f3_names(tmp_path):
    client, db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    assert_ok(client.get("/factors"))
    factor_id = "a_alpha_custom_cur_raw"
    now = "2026-05-19T10:30:00Z"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            INSERT INTO factor_definitions (
                id, name, market, universe, source, lifecycle_status, diagnostic_status,
                direction, frequency, expression, tags_json, data_requirements_json,
                institutional_note, created_by, created_at, updated_at
            )
            VALUES (?, '[估值] - 风险调整现金流回报比 (LTM/252d) [Refined-Rank]', 'US', 'SP500', 'AUTO_MINED',
                    'VERIFIED', 'COMPLETED', 'HIGH_IS_BETTER', 'DAILY', ?, ?, ?, ?,
                    'unit_test', ?, ?)
            """,
            (
                factor_id,
                VALUE_VOL_WNZT_F3_EXPRESSION,
                dumps(["自动挖掘", "检疫通过", "L3"]),
                dumps(["adj_close", "price_history", "returns", "market_cap", "operating_cash_flow"]),
                "Legacy duplicate value-volatility factor.",
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO factor_diagnostic_runs (
                id, factor_id, status, dataset_snapshot_id, universe_snapshot_id,
                request_json, summary_json, artifact_refs_json, created_at, completed_at
            )
            VALUES (?, ?, 'COMPLETED', 'ds-price', 'un-sp500', '{}', ?, '{}', ?, ?)
            """,
            (
                f"fdiag_{factor_id}_legacy_publish",
                factor_id,
                dumps({
                    **governance_ready_summary(rank_ic=0.041, ir=0.91, coverage=98.0),
                    "run_id": f"fdiag_{factor_id}_legacy_publish",
                    "factor_id": factor_id,
                    "target_layer": "L3",
                    "operator_chain": [],
                    "composition_methods": [{"key": "risk_adjusted", "label": "风险调节"}],
                }),
                now,
                now,
            ),
        )

    dry_run = assert_ok(client.post("/factors/display-name-v4-backfill", json={"dry_run": True}))
    dry_items = {item["factor_id"]: item for item in dry_run["items"]}

    assert dry_run["naming_protocol_version"] == "factor_display_name_v4_structured"
    assert dry_run["dedupe_strategy"] == "parameter_first_then_sha8"
    assert factor_id in dry_items
    assert dry_items[factor_id]["base_display_name_cn"] == "[估值] - 下行风险调节-现金流回报比 (LTM/252d) [Refined]"
    assert dry_items[factor_id]["new_display_name"] != VALUE_VOL_WNZT_F3_FACTOR_NAME
    assert dry_items[factor_id]["base_display_name_cn"].startswith("[估值] - 下行风险调节-现金流回报比")
    assert VALUE_VOL_WNZT_F3_FACTOR_ID not in dry_items[factor_id]["name_collision_group"]

    applied = assert_ok(client.post("/factors/display-name-v4-backfill", json={"dry_run": False}))
    assert applied["summary"]["applied_count"] >= 1

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT id, name
            FROM factor_definitions
            WHERE id IN (?, ?)
            """,
            (factor_id, VALUE_VOL_WNZT_F3_FACTOR_ID),
        ).fetchall()
        names = {row["id"]: row["name"] for row in rows}
        audit = conn.execute(
            """
            SELECT metadata_json
            FROM factor_display_name_renames
            WHERE factor_id = ?
            ORDER BY renamed_at DESC
            LIMIT 1
            """,
            (factor_id,),
        ).fetchone()

    assert names[factor_id] != names[VALUE_VOL_WNZT_F3_FACTOR_ID]
    assert names[factor_id].startswith("[估值] - 下行风险调节-现金流回报比")
    metadata = json.loads(audit["metadata_json"])
    assert metadata["dedupe_strategy"] == "parameter_first_then_sha8"
    assert VALUE_VOL_WNZT_F3_FACTOR_ID not in metadata["name_collision_group"]


def test_factor_library_keeps_return_raw_signals_in_f2_even_with_legacy_l1_summary(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    assert_ok(client.get("/factors"))
    now = "2026-05-19T09:30:00Z"
    legacy_return_factors = {
        "a_mom_ret_252d_raw": "Return(Close, 252)",
        "a_mom_ret_3d_raw": "Return(Close, 3)",
        "a_mom_ret_5d_raw": "Return(Close, 5)",
        "a_mom_ret_63d_raw": "Return(Close, 63)",
        "a_mom_winsor3ret_3d_raw": "Winsorize(Return(Close, 3), 3)",
    }
    with client.app.state.service.storage.connection() as conn:
        for factor_id, expression in legacy_return_factors.items():
            conn.execute(
                """
                INSERT INTO factor_definitions (
                    id, name, market, universe, source, lifecycle_status, diagnostic_status,
                    direction, frequency, expression, tags_json, data_requirements_json,
                    institutional_note, created_by, created_at, updated_at
                )
                VALUES (?, ?, 'US', 'SP500', 'AUTO_MINED', 'VERIFIED', 'COMPLETED',
                        'HIGH_IS_BETTER', 'DAILY', ?, ?, ?, ?, 'unit_test', ?, ?)
                """,
                (
                    factor_id,
                    f"Return raw signal {factor_id}",
                    expression,
                    dumps(["auto_mined", "legacy_l1_summary"]),
                    dumps(["adj_close", "price_history", "returns"]),
                    "Legacy auto-mined return raw signal.",
                    now,
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO factor_diagnostic_runs (
                    id, factor_id, status, dataset_snapshot_id, universe_snapshot_id,
                    request_json, summary_json, artifact_refs_json, created_at, completed_at
                )
                VALUES (?, ?, 'COMPLETED', 'ds-price', 'un-sp500', '{}', ?, '{}', ?, ?)
                """,
                (
                    f"fdiag_{factor_id}_legacy_l1",
                    factor_id,
                    dumps({
                        **governance_ready_summary(rank_ic=0.041, ir=0.91, coverage=98.0),
                        "run_id": f"fdiag_{factor_id}_legacy_l1",
                        "factor_id": factor_id,
                        "target_layer": "L1",
                    }),
                    now,
                    now,
                ),
            )

    payload = assert_ok(client.get("/factors?lifecycle=all"))
    by_id = {item["id"]: item for item in payload["items"]}

    for factor_id, expression in legacy_return_factors.items():
        factor = by_id[factor_id]
        assert factor["expression"] == expression
        assert factor["latest_diagnostic_summary"]["target_layer"] == "L1"
        assert factor["tier_level"] == "F2"
        assert factor["tier_projection"]["key"] == "F2"
    assert by_id["a_mom_ret_3d_raw"]["name"] == "收益率 (3d) [Raw]"
    assert by_id["a_mom_ret_3d_raw"]["name_dedupe_suffix"] == ""
    assert by_id["a_mom_winsor3ret_3d_raw"]["name"] == "平滑收益率 (3d) [Raw]"
    assert by_id["a_mom_winsor3ret_3d_raw"]["name_dedupe_suffix"] == ""


def test_factor_library_repairs_legacy_cashflow_risk_adjusted_alpha_name_without_faking_wnzt_status(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    assert_ok(client.get("/factors"))
    storage = client.app.state.service.storage
    now = "2026-05-19T10:30:00Z"
    factor_id = "a_alpha_custom_cur_raw"
    expression = "s_val_cfp_ltm_raw / s_vol_downside_252d_rank"
    with storage.connection() as conn:
        conn.execute(
            """
            INSERT INTO factor_definitions (
                id, name, market, universe, source, lifecycle_status, diagnostic_status,
                direction, frequency, expression, tags_json, data_requirements_json,
                institutional_note, created_by, created_at, updated_at
            )
            VALUES (?, 'Alpha排序因子（composite value volatility ratio）', 'US', 'SP500', 'AUTO_MINED',
                    'VERIFIED', 'COMPLETED', 'HIGH_IS_BETTER', 'DAILY', ?, ?, ?, ?,
                    'unit_test', ?, ?)
            """,
            (
                factor_id,
                expression,
                dumps(["自动挖掘", "检疫通过", "L3"]),
                dumps(["adj_close", "price_history", "returns", "market_cap", "operating_cash_flow"]),
                "Legacy auto-mined value-volatility factor.",
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO factor_diagnostic_runs (
                id, factor_id, status, dataset_snapshot_id, universe_snapshot_id,
                request_json, summary_json, artifact_refs_json, created_at, completed_at
            )
            VALUES (?, ?, 'COMPLETED', 'ds-price', 'un-sp500', '{}', ?, '{}', ?, ?)
            """,
            (
                f"fdiag_{factor_id}_legacy_publish",
                factor_id,
                dumps({
                    **governance_ready_summary(rank_ic=0.3455, ir=6.91, coverage=100.0),
                    "run_id": f"fdiag_{factor_id}_legacy_publish",
                    "factor_id": factor_id,
                    "factor_name": "Alpha因子（自定义公式）",
                    "target_layer": "L3",
                    "operator_chain": [],
                    "composition_methods": [
                        {"key": "style_blend", "label": "风格复合"},
                        {"key": "risk_adjusted", "label": "风险调节"},
                        {"key": "ts_denoise", "label": "时序降噪"},
                    ],
                }),
                now,
                now,
            ),
        )

    payload = assert_ok(client.get("/factors?lifecycle=all"))
    by_id = {item["id"]: item for item in payload["items"]}
    factor = by_id[factor_id]

    assert factor["name"] == "[估值] - 下行风险调节-现金流回报比 (LTM/252d) [Raw]"
    assert "(LTM/252d)" in factor["display_name_cn"]
    assert "[Raw]" in factor["display_name_cn"]
    assert "[Refined]" not in factor["display_name_cn"]
    assert "[Refined-Rank]" not in factor["display_name_cn"]
    assert factor["base_display_name_cn"] == "[估值] - 下行风险调节-现金流回报比 (LTM/252d) [Raw]"
    assert factor["name_collision_key"]
    assert VALUE_VOL_WNZT_F3_FACTOR_ID not in factor["name_collision_group"]
    suffix = factor["name_dedupe_suffix"]
    assert suffix == ""
    assert factor["name_audit"]["dedupe_strategy"] == "parameter_first_then_sha8"
    assert factor["naming_protocol_version"] == "factor_display_name_v4_structured"
    assert factor["name_schema_version"] == "factor_display_name_v4"
    assert factor["op_status"]["completed"] == []
    assert factor["op_status"]["missing"] == ["W", "N", "Z", "T"]
    value_vol = by_id[VALUE_VOL_WNZT_F3_FACTOR_ID]
    assert value_vol["display_name_cn"] != factor["display_name_cn"]
    assert factor_id not in value_vol["name_collision_group"]
    stored_name = storage.fetch_one("SELECT name FROM factor_definitions WHERE id = ?", (factor_id,))["name"]
    assert stored_name.startswith("[估值] - 下行风险调节-现金流回报比 (LTM/252d) [Raw]")


def test_factor_library_lifecycle_queries_accept_phase1_aliases(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    assert_ok(client.get("/factors"))

    all_payload = assert_ok(client.get("/factors?lifecycle=all"))
    online_payload = assert_ok(client.get("/factors?lifecycle=online"))
    sandbox_payload = assert_ok(client.get("/factors?lifecycle=sandbox"))
    to_be_verified_payload = assert_ok(client.get("/factors?lifecycle=to_be_verified"))
    archived_payload = assert_ok(client.get("/factors?lifecycle=archived"))
    offline_alias_payload = assert_ok(client.get("/factors?lifecycle=offline"))

    assert len(all_payload["items"]) >= len(online_payload["items"])
    assert all(item["lifecycle"] == "online" for item in online_payload["items"])
    assert all(item["lifecycle"] == "sandbox" for item in sandbox_payload["items"])
    assert all(item["lifecycle"] == "to_be_verified" for item in to_be_verified_payload["items"])
    assert all(item["lifecycle"] == "archived" for item in archived_payload["items"])
    assert [item["id"] for item in archived_payload["items"]] == [item["id"] for item in offline_alias_payload["items"]]


def test_factor_library_projects_standard_factor_categories(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    payload = assert_ok(client.get("/factors"))
    by_id = {item["id"]: item for item in payload["items"]}

    assert by_id["s_beta_resid_252d_z"]["descriptor"]["category"] == "beta"
    assert by_id["s_beta_resid_252d_z"]["factor_family"] == "风险"
    assert by_id["s_inv_assetgrowth_1y_rank"]["descriptor"]["category"] == "inv"
    assert by_id["s_inv_assetgrowth_1y_rank"]["factor_family"] == "质量"
    assert by_id["s_inv_capex_ltm_raw"]["factor_family"] == "质量"
    assert by_id["s_liq_turnover_20d_rank"]["descriptor"]["category"] == "liq"
    assert by_id["s_liq_turnover_20d_rank"]["factor_family"] == "情绪"
    assert by_id["s_alpha_ffblend_resid_mkt_rank"]["factor_family"] == "其他"


def test_factor_library_migrates_system_seed_expression_versions(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    assert_ok(client.get("/factors"))
    storage = client.app.state.service.storage
    legacy_expressions = {
        "s_alpha_ffblend_resid_mkt_rank": "Rank(Return(Close, 252))",
        "s_beta_market_252d_raw": "Return(Close, 252)",
        "s_beta_resid_252d_z": "ZScore(Return(Close, 252))",
        "s_inv_assetgrowth_1y_rank": "Return(Close, 252)",
    }
    expected_expressions = {
        "s_alpha_ffblend_resid_mkt_rank": "Rank(ZScore(Residual(Winsorize(FFBlend(Momentum252, ValueEP, QualityROE, Size), 3), s_beta_market_252d_raw)))",
        "s_beta_market_252d_raw": "BetaToMarket(Close, 252)",
        "s_beta_resid_252d_z": "ResidualVolatility(Close, 252)",
        "s_inv_assetgrowth_1y_rank": "SharesOutstandingGrowth(252) + CapexLTM / MarketCap",
    }
    for factor_id, expression in legacy_expressions.items():
        storage.execute(
            "UPDATE factor_definitions SET expression = ? WHERE id = ?",
            (expression, factor_id),
        )
        storage.execute(
            "UPDATE factor_versions SET expression = ?, metadata_json = ? WHERE factor_id = ? AND version = 1",
            (expression, dumps({"source": "legacy_system_seed"}), factor_id),
        )

    payload = assert_ok(client.get("/factors"))
    by_id = {item["id"]: item for item in payload["items"]}

    for factor_id, expression in expected_expressions.items():
        assert by_id[factor_id]["expression"] == expression
        version = storage.fetch_one(
            "SELECT expression, status, metadata_json FROM factor_versions WHERE factor_id = ? AND version = 1",
            (factor_id,),
        )
        assert version["expression"] == expression
        assert version["status"] == "ACTIVE"
        assert '"SYSTEM_SEED"' in version["metadata_json"]


def test_investment_seed_factors_do_not_share_degenerate_capex_signal(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)

    assert_ok(client.get("/factors"))
    repository = client.app.state.service.market_data_repository
    point_rows = repository.load_dataset_fundamental_points(
        "ds-fundamentals",
        ["AAPL", "MSFT", "NVDA", "AMZN"],
        start_date="2020-01-01",
        end_date="2026-01-01",
        as_of_date="2026-01-01",
    )
    share_paths = {
        symbol: {
            round(float(row["shares_outstanding"]), 4)
            for row in rows
            if row.get("shares_outstanding") is not None
        }
        for symbol, rows in point_rows.items()
    }
    assert all(len(values) > 1 for values in share_paths.values())

    preview = assert_ok(
        client.post(
            "/factors/diagnostics/preview",
            json={
                "batch": True,
                "factor_ids": ["s_inv_assetgrowth_1y_rank", "s_inv_capex_ltm_raw"],
                "diagnostic_mode": "SANDBOX",
                "include": ["ic", "ir", "groups", "turnover"],
            },
        )
    )
    by_id = {item["factor_id"]: item["latest_diagnostic_summary"] for item in preview["items"]}
    asset_growth = by_id["s_inv_assetgrowth_1y_rank"]
    capex = by_id["s_inv_capex_ltm_raw"]

    assert asset_growth["data_lineage"]["kind"] == "FACTOR_EXPRESSION_PREVIEW"
    assert capex["data_lineage"]["kind"] == "FACTOR_EXPRESSION_PREVIEW"
    assert round(asset_growth["rank_ic"], 4) != round(capex["rank_ic"], 4)
    assert asset_growth["group_returns"] != capex["group_returns"]


def test_factor_library_projects_real_preview_metrics_for_new_factors(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    pit = assert_ok(client.get("/pit-data"))
    diagnostic_payload = {
        "start_date": pit["diagnostic_windows"]["verified"]["start_date"],
        "end_date": pit["as_of_date"],
        "dataset_snapshot_id": pit["dataset_snapshot_id"],
        "universe_snapshot_id": pit["universe_snapshot_id"],
        "return_window_days": 21,
        "group_count": 5,
        "diagnostic_mode": "VERIFIED",
    }
    reference_factor_ids = [
        "s_mom_12m1m_rank",
        "s_vol_252d_rank",
        "s_size_cur_log",
        "s_val_ep_ltm_raw",
        "s_qlty_fcfy_ttm_raw",
    ]
    for factor_id in reference_factor_ids:
        assert_ok(client.post(f"/factors/{factor_id}/diagnostics", json=diagnostic_payload))

    created = assert_ok(
        client.post(
            "/factors",
            json={
                "name": "5日动量",
                "market": "US",
                "universe": "SP500",
                "expression": "Rank(Delta(Close, 5))",
                "frequency": "DAILY",
                "direction": "HIGH_IS_BETTER",
                "descriptor": manual_descriptor(),
                "tags": ["人工"],
            },
        )
    )
    created_summary = created["latest_diagnostic_summary"]
    assert created_summary is None

    factors = assert_ok(client.get("/factors"))
    by_id = {item["id"]: item for item in factors["items"]}
    manual_summary = by_id["m_mom_short_5d_rank"]["latest_diagnostic_summary"]
    expanded_summary = by_id["s_mom_6m_rank"]["latest_diagnostic_summary"]

    assert manual_summary is None
    assert expanded_summary is None
    assert by_id["m_mom_short_5d_rank"]["last_diagnostic_run_id"] is None

    before_runs = client.app.state.service.storage.fetch_one(
        "SELECT COUNT(*) AS count FROM factor_diagnostic_runs"
    )["count"]
    preview = assert_ok(
        client.post(
            "/factors/diagnostics/preview",
            json={
                "batch": True,
                "factor_ids": ["m_mom_short_5d_rank", "s_mom_6m_rank"],
                "diagnostic_mode": "SANDBOX",
                "include": ["ic", "ir", "groups", "turnover"],
            },
        )
    )
    after_runs = client.app.state.service.storage.fetch_one(
        "SELECT COUNT(*) AS count FROM factor_diagnostic_runs"
    )["count"]
    preview_by_id = {item["factor_id"]: item for item in preview["items"]}

    assert after_runs == before_runs
    for factor_id in ["m_mom_short_5d_rank", "s_mom_6m_rank"]:
        summary = preview_by_id[factor_id]["latest_diagnostic_summary"]
        assert summary["status"] == "PREVIEW"
        assert summary["factor_id"] == factor_id
        assert summary["data_lineage"]["kind"] == "FACTOR_EXPRESSION_PREVIEW"
        assert "source_factor_id" not in summary
        assert isinstance(summary["rank_ic"], float)
        assert preview_by_id[factor_id]["batch_diagnostic_summary"]["status"] == "PREVIEW"

    style_preview = assert_ok(
        client.post(
            "/factors/diagnostics/preview",
            json={
                "batch": True,
                "factor_ids": [
                    "s_alpha_ffblend_resid_mkt_rank",
                    "s_beta_market_252d_raw",
                    "s_beta_resid_252d_z",
                    "s_inv_assetgrowth_1y_rank",
                ],
                "diagnostic_mode": "SANDBOX",
                "include": ["ic", "ir"],
            },
        )
    )
    style_by_id = {item["factor_id"]: item for item in style_preview["items"]}
    style_rank_ics = {
        factor_id: style_by_id[factor_id]["latest_diagnostic_summary"]["rank_ic"]
        for factor_id in style_by_id
    }
    assert set(style_by_id) == {
        "s_alpha_ffblend_resid_mkt_rank",
        "s_beta_market_252d_raw",
        "s_beta_resid_252d_z",
        "s_inv_assetgrowth_1y_rank",
    }
    assert all(
        item["latest_diagnostic_summary"]["data_lineage"]["kind"] == "FACTOR_EXPRESSION_PREVIEW"
        for item in style_by_id.values()
    )
    assert len({by_id[factor_id]["expression"] for factor_id in style_by_id}) == len(style_by_id)
    for factor_id in style_by_id:
        assert by_id[factor_id]["strategy_creation_risk"]["blocked_count"] == 0
        assert by_id[factor_id]["blocker_reason_summary"]["status"] in {"warning", "clear"}
    assert len({round(value, 4) for value in style_rank_ics.values() if isinstance(value, float)}) >= 2
    assert round(style_rank_ics["s_alpha_ffblend_resid_mkt_rank"], 4) != round(style_rank_ics["s_beta_market_252d_raw"], 4)


def test_factor_library_hot_path_does_not_call_heavy_pit_overview(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)

    service = client.app.state.service
    service._factor_research_service_instance = None

    def fail_if_called():
        raise AssertionError("/factors must not wait for the heavy PIT overview builder")

    service.get_pit_data_overview = fail_if_called

    payload = assert_ok(client.get("/factors"))

    assert payload["items"]
    assert payload["summary"]["pit_status"] in {"READY", "LIMITED_READY", "BLOCKED"}
    assert payload["summary"]["factor_admission_status"] in {"READY", "REPAIR", "BLOCKED"}
    assert isinstance(payload["summary"]["factor_admission_blocks"], bool)


def test_factor_detail_hot_path_does_not_call_heavy_pit_overview(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)

    service = client.app.state.service
    service._factor_research_service_instance = None

    def fail_if_called():
        raise AssertionError("/factors/{id} must not wait for the heavy PIT overview builder")

    service.get_pit_data_overview = fail_if_called

    payload = assert_ok(client.get("/factors/s_alpha_ffblend_resid_mkt_rank"))

    assert payload["id"] == "s_alpha_ffblend_resid_mkt_rank"
    assert payload["name"] == "[综合] - FF3 风格复合基石 (等权) [Beta-Free]"
    assert payload["diagnostic_status"] in {"READY_TO_DIAGNOSE", "SANDBOX_READY", "COMPLETED"}


def test_factor_library_does_not_fake_ic_sparkline_without_diagnostic(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)

    payload = assert_ok(client.get("/factors"))
    factor = next(item for item in payload["items"] if item["id"] == "s_beta_market_252d_raw")

    assert factor["latest_diagnostic_summary"] is None
    assert factor["ic_sparkline"] == []
    assert factor["diagnostic_gap_summary"]["rank_ic"].startswith("Rank IC:")


def test_value_vol_wnzt_seed_factor_projects_complete_metric_slots(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)

    payload = assert_ok(client.get("/factors"))
    factor = next(item for item in payload["items"] if item["id"] == VALUE_VOL_WNZT_F3_FACTOR_ID)

    run_count = client.app.state.service.storage.fetch_one(
        "SELECT COUNT(*) AS count FROM factor_diagnostic_runs WHERE factor_id = ?",
        (VALUE_VOL_WNZT_F3_FACTOR_ID,),
    )
    assert int(run_count["count"]) == 0
    assert factor["latest_diagnostic_summary"]["data_lineage"]["kind"] == "SYSTEM_SEED_AUDIT_PROJECTION"
    assert factor["latest_diagnostic_summary"]["metric_projection_source"] == "system_seed_audit_projection"
    assert factor["quality_view"]["rank_ic"] == 0.1
    assert factor["quality_view"]["ir"] == 0.11
    assert factor["quality_view"]["decay_days"] == 252
    composite = factor["composite_view"]
    assert composite["quality"]["sharpe"] == 0.553
    assert composite["quality"]["max_drawdown_pct"] == 12.34
    assert composite["turnover_cost"]["turnover_rate_weekly"] == 18.0
    assert composite["turnover_cost"]["cost_bps"] == 9.0
    assert composite["style_exposure"]["style_corr"] == 0.26
    assert composite["source"]["metric_projection_source"] == "system_seed_audit_projection"
    assert composite["source"]["sharpe_source"] == "system_seed_audit_projection"
    assert composite["source"]["cost_source"] == "system_seed_audit_projection"
    assert factor["op_status"]["completed"] == ["W", "N", "Z", "T"]
    assert factor["op_status"]["missing"] == []


def test_factor_governance_projection_maps_diagnostic_states_to_management_rules(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    factor_service = client.app.state.service._factor_research_service()

    stable_ic_series = [
        {"date": f"2026-0{month}-01", "rank_ic": value}
        for month, value in enumerate([0.032, 0.031, 0.034, 0.033, 0.032, 0.031], start=1)
    ]
    robust_summary = {
        "run_id": "diag_state_probe",
        "status": "COMPLETED",
        "rank_ic": 0.021,
        "ir": 0.72,
        "coverage": 91.2,
        "group_returns": [
            {"group": "Q1", "mean_return": 0.052, "sample_count": 120},
            {"group": "Q2", "mean_return": 0.031, "sample_count": 120},
            {"group": "Q3", "mean_return": 0.011, "sample_count": 120},
            {"group": "Q4", "mean_return": -0.004, "sample_count": 120},
            {"group": "Q5", "mean_return": -0.019, "sample_count": 120},
        ],
        "ic_series": stable_ic_series,
    }

    def classify(summary, **overrides):
        factor = {
            "id": "s_diag_state_probe",
            "name": "诊断状态探针",
            "expression": "Rank(Return(Close, 126))",
            "lifecycle_status": "VERIFIED",
            "diagnostic_status": "COMPLETED",
            "pit_coverage": {"missing_fields": [], "available_at_gate": True},
            "readiness_blockers": [],
            "latest_diagnostic_summary": summary,
            **overrides,
        }
        policy = factor_service._build_blocker_policy(factor, {"nodes": [], "edges": []})
        state, label = factor_service._classify_factor_ui_state(factor, policy)
        return state, label, policy

    state, label, policy = classify(robust_summary)
    assert (state, label) == ("robust", "稳健")
    assert policy["hard_blocker_count"] == 0
    assert policy["warning_count"] == 0

    calibrated_summary = {**robust_summary, "coverage": 88.8}
    state, label, policy = classify(calibrated_summary)
    assert (state, label) == ("needs_calibration", "待校准")
    assert any(item["code"] == "COVERAGE_EDGE" for item in policy["warnings"])

    sandbox_completed_summary = {**robust_summary, "diagnostic_mode": "SANDBOX"}
    state, label, policy = classify(sandbox_completed_summary, diagnostic_status="SANDBOX_READY")
    assert (state, label) == ("robust", "稳健")
    assert policy["hard_blocker_count"] == 0
    assert policy["warning_count"] == 0

    current_only_blocker = {
        "code": "CURRENT_ONLY_DATA",
        "severity": "blocker",
        "label": "current-only data",
        "message": "current-only data cannot be replayed",
    }
    state, label, policy = classify(
        sandbox_completed_summary,
        diagnostic_status="BLOCKED_DATA",
        readiness_blockers=[current_only_blocker],
    )
    assert state == "sandbox"
    assert policy["hard_blocker_count"] == 1
    assert any(item["code"] == "CURRENT_ONLY_DATA" for item in policy["hard_blockers"])

    repair_warning = {
        "code": "FACTOR_ADMISSION_10Y_REPAIR",
        "severity": "warning",
        "label": "10Y 准入补源队列",
        "message": "10 个窗口内活跃标的仍需补齐价格证据或身份映射；因子准入仍允许，但需保留修复披露。",
    }
    state, label, policy = classify(sandbox_completed_summary, diagnostic_status="SANDBOX_READY", readiness_blockers=[repair_warning])
    assert (state, label) == ("needs_calibration", "待校准")
    assert policy["hard_blocker_count"] == 0
    assert any(item["code"] == "FACTOR_ADMISSION_10Y_REPAIR" for item in policy["warnings"])

    reference_only_summary = {**sandbox_completed_summary, "status": "REFERENCE_ONLY"}
    state, label, policy = classify(reference_only_summary, diagnostic_status="SANDBOX_READY")
    assert (state, label) == ("needs_calibration", "待校准")
    assert policy["hard_blocker_count"] == 0

    decayed_summary = {**robust_summary, "rank_ic": 0.004, "ir": 0.1}
    state, label, policy = classify(decayed_summary)
    assert (state, label) == ("decayed", "失效")
    assert any(item["code"] == "FACTOR_GRADE_DECAYED" for item in policy["hard_blockers"])

    latest_only_inverted_summary = {
        **robust_summary,
        "group_returns": [
            {"group": "Q1", "mean_return": -0.012, "sample_count": 120},
            {"group": "Q5", "mean_return": 0.038, "sample_count": 120},
        ],
    }
    state, label, policy = classify(latest_only_inverted_summary)
    assert (state, label) == ("needs_calibration", "待校准")
    assert not any(item["code"] == "GROUP_RETURNS_INVERTED" for item in policy["hard_blockers"])
    assert any(item["code"] == "GROUP_RETURNS_MONOTONICITY_WEAK" for item in policy["warnings"])

    recovered_historical_inversion_summary = {
        **robust_summary,
        "group_returns": [
            {"group": "Q1", "mean_return": 0.0167, "sample_count": 176},
            {"group": "Q2", "mean_return": 0.0082, "sample_count": 176},
            {"group": "Q3", "mean_return": 0.0139, "sample_count": 177},
            {"group": "Q4", "mean_return": 0.0182, "sample_count": 176},
            {"group": "Q5", "mean_return": -0.0051, "sample_count": 177},
        ],
        "group_return_series": [
            {
                "date": f"2026-0{month}-01",
                "groups": [
                    {"group": "Q1", "mean_return": q1, "sample_count": 120},
                    {"group": "Q5", "mean_return": q5, "sample_count": 120},
                ],
            }
            for month, q1, q5 in [
                (1, -0.010, 0.022),
                (2, -0.012, 0.026),
                (3, -0.011, 0.028),
                (4, -0.013, 0.027),
                (5, -0.009, 0.025),
                (6, 0.080, -0.020),
                (7, 0.070, -0.010),
                (8, 0.060, -0.015),
            ]
        ],
    }
    state, label, policy = classify(recovered_historical_inversion_summary)
    assert (state, label) == ("needs_calibration", "待校准")
    assert not any(item["code"] == "GROUP_RETURNS_INVERTED" for item in policy["hard_blockers"])
    weak_warning = next(item for item in policy["warnings"] if item["code"] == "GROUP_RETURNS_MONOTONICITY_WEAK")
    assert weak_warning["monotonicity"]["current_inverted_streak"] == 0
    assert weak_warning["monotonicity"]["max_inverted_streak"] >= 3
    normalized_summary = factor_service._latest_diagnostic_summary(
        {
            "latest_diagnostic_summary": {
                **recovered_historical_inversion_summary,
                "monotonicity": {"available": True, "inverted": True, "max_inverted_streak": 3},
            }
        }
    )
    assert normalized_summary["monotonicity"]["inverted"] is False
    assert normalized_summary["monotonicity"]["current_inverted_streak"] == 0

    persistent_inverted_summary = {
        **robust_summary,
        "group_returns": [
            {"group": "Q1", "mean_return": -0.011, "sample_count": 360},
            {"group": "Q5", "mean_return": 0.026, "sample_count": 360},
        ],
        "group_return_series": [
            {
                "date": f"2026-0{month}-01",
                "groups": [
                    {"group": "Q1", "mean_return": q1, "sample_count": 120},
                    {"group": "Q5", "mean_return": q5, "sample_count": 120},
                ],
            }
            for month, q1, q5 in [
                (1, -0.010, 0.022),
                (2, -0.012, 0.026),
                (3, -0.011, 0.028),
                (4, -0.013, 0.027),
                (5, -0.009, 0.025),
            ]
        ],
    }
    state, label, policy = classify(persistent_inverted_summary)
    assert (state, label) == ("decayed", "失效")
    assert any(item["code"] == "GROUP_RETURNS_INVERTED" for item in policy["hard_blockers"])
    blocker = next(item for item in policy["hard_blockers"] if item["code"] == "GROUP_RETURNS_INVERTED")
    assert blocker["monotonicity"]["current_inverted_streak"] == 3

    state, label, policy = classify(None, diagnostic_status="READY_TO_DIAGNOSE")
    assert (state, label) == ("sandbox", "沙箱")
    assert policy["hard_blocker_count"] == 0


def test_factor_list_governance_projection_warns_for_correlation_without_blocking(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)

    payload = assert_ok(client.get("/factors"))
    factors = payload["items"]
    warned = [
        item
        for item in factors
        if item["correlation_cluster_summary"]["high_correlation_count"] > 0
        and item["strategy_creation_risk"]["warning_count"] > 0
    ]

    assert warned
    for factor in warned[:5]:
        assert factor["strategy_creation_risk"]["can_create"] is True
        assert factor["strategy_creation_risk"]["blocked_count"] == 0
        assert factor["blocker_reason_summary"]["status"] in {"warning", "clear"}
        assert any(
            warning["code"] == "HIGH_CORRELATION"
            for warning in factor["strategy_creation_risk"]["warnings"]
        )


def test_factor_governance_overview_promotes_live_like_momentum_tasks_without_history(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)

    created_specs = [
        (
            "6m residual momentum",
            'ZScore(Residual(s_mom_6m_rank, by="s_vol_252d_raw"))',
            "long",
            "z",
            "m_mom_long_126d_z",
        ),
        (
            "risk adjusted momentum",
            "Rank(s_mom_6m_rank / s_vol_126d_raw)",
            "longra",
            "rank",
            "m_mom_longra_126d_rank",
        ),
        (
            "downside risk adjusted momentum",
            "Rank(s_mom_6m_rank / s_vol_downside_126d_raw)",
            "longdra",
            "rank",
            "m_mom_longdra_126d_rank",
        ),
    ]
    for name, expression, metric, operator, expected_id in created_specs:
        created = assert_ok(
            client.post(
                "/factors",
                json={
                    "name": name,
                    "market": "US",
                    "universe": "SP500",
                    "expression": expression,
                    "frequency": "DAILY",
                    "direction": "HIGH_IS_BETTER",
                    "descriptor": manual_descriptor(metric=metric, window="126d", operator=operator),
                    "tags": ["manual"],
                },
            )
        )
        assert created["id"] == expected_id

    deprecate_id = "m_mom_long_126d_z"
    keep_id = "m_mom_longra_126d_rank"
    prune_id = "m_mom_longdra_126d_rank"
    seed_factor_diagnostic_summary(
        client,
        deprecate_id,
        governance_ready_summary(rank_ic=0.0088, ir=0.1988, coverage=98.54),
        run_id="fdiag_live_like_noise",
    )
    seed_factor_diagnostic_summary(
        client,
        keep_id,
        governance_ready_summary(rank_ic=0.0308, ir=1.3205, coverage=99.13),
        run_id="fdiag_live_like_keep",
    )
    seed_factor_diagnostic_summary(
        client,
        prune_id,
        governance_ready_summary(rank_ic=0.0294, ir=1.2591, coverage=99.13),
        run_id="fdiag_live_like_prune",
    )

    overview = assert_ok(client.get("/factor-governance/overview"))
    actions = overview["actions"]
    unsupported_kinds = {
        item["kind"]
        for item in actions
        if item["kind"] not in {"DEPRECATE", "PRUNE", "FACTOR_MODEL_SUGGESTION", "FACTOR_OPTIMIZATION"}
    }

    assert unsupported_kinds == set()
    assert all(
        not (item["kind"] == "DEPRECATE" and deprecate_id in item["factor_ids"])
        for item in actions
    )
    assert all(
        not (item["kind"] == "PRUNE" and prune_id in item["factor_ids"])
        for item in actions
    )


def test_factor_governance_overview_reuses_single_factor_read_model(tmp_path, monkeypatch):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    factor_service = client.app.state.service._factor_research_service()
    original_list_factors = factor_service.list_factors
    calls: list[dict[str, object]] = []

    def counting_list_factors(*args, **kwargs):
        calls.append(dict(kwargs))
        return original_list_factors(*args, **kwargs)

    monkeypatch.setattr(factor_service, "list_factors", counting_list_factors)

    overview = assert_ok(client.get("/factor-governance/overview"))

    assert "actions" in overview
    assert len(calls) == 1
    assert calls[0].get("lifecycle") == "all"
    assert calls[0].get("include_governance_queue") is False


def test_factor_governance_prune_requires_measured_rankic_correlation(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    keep_id = "m_mom_longra_126d_rank"
    prune_id = "m_mom_longdra_126d_rank"
    for expected_id, name, expression, metric in [
        (keep_id, "risk adjusted momentum", "Rank(s_mom_6m_rank / s_vol_126d_raw)", "longra"),
        (prune_id, "downside risk adjusted momentum", "Rank(s_mom_6m_rank / s_vol_downside_126d_raw)", "longdra"),
    ]:
        created = assert_ok(
            client.post(
                "/factors",
                json={
                    "name": name,
                    "market": "US",
                    "universe": "SP500",
                    "expression": expression,
                    "frequency": "DAILY",
                    "direction": "HIGH_IS_BETTER",
                    "descriptor": manual_descriptor(metric=metric, window="126d", operator="rank"),
                    "tags": ["manual"],
                },
            )
        )
        assert created["id"] == expected_id
    keep_values = [0.011, 0.013, 0.015, 0.018, 0.017, 0.021, 0.024, 0.026, 0.025, 0.029]
    prune_values = [value * 0.93 + 0.001 for value in keep_values]
    seed_factor_diagnostic_summary(
        client,
        keep_id,
        governance_ready_summary_with_ic_series(rank_ic=0.0308, ir=1.3205, coverage=99.13, values=keep_values),
        run_id="fdiag_measured_keep",
    )
    seed_factor_diagnostic_summary(
        client,
        prune_id,
        governance_ready_summary_with_ic_series(rank_ic=0.0294, ir=1.2591, coverage=99.13, values=prune_values),
        run_id="fdiag_measured_prune",
    )

    overview = assert_ok(client.get("/factor-governance/overview"))
    action = next(
        item for item in overview["actions"] if item["kind"] == "PRUNE" and prune_id in item["factor_ids"]
    )
    assert action["command"] == "PRUNE"
    assert action["keep_factor_id"] == keep_id
    assert action["offline_detail"]["correlation"] > 0.9
    assert action["offline_detail"]["evidence_source"] == "MEASURED_DIAGNOSTIC_IC_SERIES"
    assert action["offline_detail"]["sample_count"] == len(keep_values)
    assert action["offline_detail"]["operator_status_light"]["same"] is True


def test_factor_governance_prune_requires_same_operator_status_light(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    raw_id = "m_mom_statuslight_21d_raw"
    refined_id = "m_mom_statuslight_21d_rank"
    for expected_id, name, expression, operator in [
        (raw_id, "status light raw return", "Return(Close, 21)", "raw"),
        (
            refined_id,
            "status light refined return",
            "ZScore(Rank(Return(Close, 21)))",
            "rank",
        ),
    ]:
        created = assert_ok(
            client.post(
                "/factors",
                json={
                    "name": name,
                    "market": "US",
                    "universe": "SP500",
                    "expression": expression,
                    "frequency": "DAILY",
                    "direction": "HIGH_IS_BETTER",
                    "descriptor": manual_descriptor(metric="statuslight", window="21d", operator=operator),
                    "tags": ["manual"],
                },
            )
        )
        assert created["id"] == expected_id
    raw_values = [0.011, 0.013, 0.015, 0.018, 0.017, 0.021, 0.024, 0.026, 0.025, 0.029]
    refined_values = [value * 0.94 + 0.001 for value in raw_values]
    seed_factor_diagnostic_summary(
        client,
        raw_id,
        governance_ready_summary_with_ic_series(rank_ic=0.034, ir=1.6, coverage=99.1, values=raw_values),
        run_id="fdiag_status_light_raw",
    )
    seed_factor_diagnostic_summary(
        client,
        refined_id,
        governance_ready_summary_with_ic_series(rank_ic=0.028, ir=1.1, coverage=98.4, values=refined_values),
        run_id="fdiag_status_light_refined",
    )

    overview = assert_ok(client.get("/factor-governance/overview"))
    assert all(
        not (item["kind"] == "PRUNE" and set(item["factor_ids"]).intersection({raw_id, refined_id}))
        for item in overview["actions"]
    )
    factor_service = client.app.state.service._factor_research_service()
    raw_factor = assert_ok(client.get(f"/factors/{raw_id}"))
    refined_factor = assert_ok(client.get(f"/factors/{refined_id}"))
    evidence = factor_service._factor_pair_prune_correlation_evidence(refined_factor, raw_factor)  # noqa: SLF001
    assert evidence["reason"] == "operator_status_light_mismatch"
    assert evidence["operator_status_light"]["same"] is False


def test_factor_governance_prune_rejects_library_heatmap_when_publish_ic_series_is_synthetic(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    now = "2026-05-22T09:30:00Z"
    factor_specs = [
        (
            "s_f2_mom_raw_cur_f1_return_21d_base",
            "Auto mined 21d smoothed return",
            "ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_return_21d_base, 3), 3), method=\"MAD\"), by=\"industry,market_cap\"))",
            0.5,
            99.47,
        ),
        (
            "s_f2_mom_raw_cur_f1_price_close",
            "Auto mined current smoothed return",
            "ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_price_close, 3), 5), method=\"MAD\"), by=\"industry,market_cap\"))",
            0.4472,
            99.34,
        ),
        (
            "s_f2_mom_raw_cur_f1_return_1d_base",
            "Auto mined 1d smoothed return",
            "ZScore(Neutralize(Winsorize(TS_Rank(TS_Return(f1_return_1d_base, 21), 5), method=\"MAD\"), by=\"industry,market_cap\"))",
            0.2132,
            97.09,
        ),
    ]
    with client.app.state.service.storage.connection() as conn:
        for factor_id, name, expression, _ir, _coverage in factor_specs:
            conn.execute(
                """
                INSERT INTO factor_definitions (
                    id, name, market, universe, source, lifecycle_status, diagnostic_status,
                    direction, frequency, expression, tags_json, data_requirements_json,
                    institutional_note, created_by, created_at, updated_at
                )
                VALUES (?, ?, 'US', 'SP500', 'AUTO_MINED', 'VERIFIED', 'COMPLETED',
                        'HIGH_IS_BETTER', 'DAILY', ?, ?, ?, ?, 'unit_test', ?, ?)
                """,
                (
                    factor_id,
                    name,
                    expression,
                    dumps(["auto_mined", "momentum", "Raw"]),
                    dumps(["adj_close", "price_history", "returns"]),
                    "Published from factor quarantine without measured RankIC series.",
                    now,
                    now,
                ),
            )
    for factor_id, _name, _expression, ir, coverage in factor_specs:
        seed_factor_diagnostic_summary(
            client,
            factor_id,
            {
                "status": "COMPLETED",
                "diagnostic_mode": "VERIFIED",
                "run_id": f"fdiag_{factor_id}_publish",
                "factor_id": factor_id,
                "rank_ic": 0.05,
                "ic": 0.046,
                "ir": ir,
                "coverage": coverage,
                "quarantine": {"candidate_id": f"fq_{factor_id}"},
                "data_lineage": {"kind": "QUARANTINE_PUBLISH_SUMMARY"},
            },
            run_id=f"fdiag_{factor_id}_publish",
        )

    overview = assert_ok(client.get("/factor-governance/overview"))
    published_ids = {factor_id for factor_id, *_rest in factor_specs}
    prune_actions = [
        action
        for action in overview["actions"]
        if action["kind"] == "PRUNE" and set(action["factor_ids"]).intersection(published_ids)
    ]
    assert prune_actions == []

    detail = assert_ok(client.get("/factors/s_f2_mom_raw_cur_f1_return_1d_base"))
    summary = detail["latest_diagnostic_summary"]
    assert summary["ic_series"]
    assert summary["ic_series_evidence_quality"] == "synthetic_projection"
    assert summary["ic_series_source"] == "auto_mined_rank_ic_projection"

    factor_service = client.app.state.service._factor_research_service()
    keep_factor = assert_ok(client.get("/factors/s_f2_mom_raw_cur_f1_return_21d_base"))
    synthetic_peer = assert_ok(client.get("/factors/s_f2_mom_raw_cur_f1_price_close"))
    evidence = factor_service._factor_pair_prune_correlation_evidence(synthetic_peer, keep_factor)  # noqa: SLF001
    assert evidence["eligible"] is False
    assert evidence["reason"] == "synthetic_rank_ic_series_not_prune_evidence"


def test_factor_governance_optimizes_inverted_downside_factor_and_publishes_reverse(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    assert_ok(client.get("/factors"))
    source_summary = {
        **governance_ready_summary(rank_ic=-0.024, ir=-1.15, coverage=96.4, inverted=True),
        "group_return_series": inverted_group_return_series(),
    }
    seed_factor_diagnostic_summary(
        client,
        "s_vol_downside_252d_rank",
        source_summary,
        run_id="fdiag_downside_inverted",
    )

    overview = assert_ok(client.get("/factor-governance/overview"))
    deprecate_action = next(
        item
        for item in overview["actions"]
        if item["kind"] == "DEPRECATE" and "s_vol_downside_252d_rank" in item["factor_ids"]
    )
    optimize_action = next(
        item
        for item in overview["actions"]
        if item["kind"] == "FACTOR_OPTIMIZATION" and "s_vol_downside_252d_rank" in item["factor_ids"]
    )

    assert deprecate_action["offline_detail"]["persistent_group_inversion"] is True
    assert deprecate_action["offline_reason"] == "强制下线：3 期滑动均值连续 3 期 Q1 低于 Q5，因子封存复盘。"
    optimized = optimize_action["optimized_factor"]
    assert optimize_action["command"] == "PUBLISH_OPTIMIZED_FACTOR"
    assert optimized["id"] == "s_alpha_vol_downsiderev_std_rk"
    assert optimized["publish_naming_rule"] == "factor_display_name_v4"
    assert optimized["name"] == "[风险] - 反向下行风险 Alpha (252d) [Refined-Rank]"
    assert optimized["display_name_cn"] == "[风险] - 反向下行风险 Alpha (252d) [Refined-Rank]"
    assert optimized["name_schema_version"] == "factor_display_name_v4"
    assert optimized["direction"] == "HIGH_IS_BETTER"
    assert optimized["grade"] in {"A", "B"}
    assert optimized["confirmable"] is True
    assert optimized["diagnostic_summary"]["rank_ic"] == 0.024
    assert optimized["diagnostic_summary"]["ir"] == 1.15
    assert optimized["diagnostic_summary"]["monotonicity"]["monotonic_good"] is True
    assert optimized["diagnostic_summary"]["monotonicity"]["inverted"] is False
    for row in optimized["diagnostic_summary"]["group_return_series"][-3:]:
        assert row["q1_mean_return"] > row["q5_mean_return"]
        assert row["groups"][0]["mean_return"] == row["q1_mean_return"]
        assert row["groups"][-1]["mean_return"] == row["q5_mean_return"]

    executed = assert_ok(
        client.post(
            f"/factor-governance/actions/{optimize_action['id']}/execute",
            json={
                "confirm": True,
                "command": "PUBLISH_OPTIMIZED_FACTOR",
                "factor_ids": ["s_vol_downside_252d_rank"],
                "reason": "用户确认反向因子 Grade A/B 入库。",
                "detail": {"action_id": optimize_action["id"]},
            },
        )
    )
    assert executed["command"] == "PUBLISH_OPTIMIZED_FACTOR"
    assert executed["created_factor_id"] == "s_alpha_vol_downsiderev_std_rk"
    created = assert_ok(client.get("/factors/s_alpha_vol_downsiderev_std_rk"))
    assert created["name"] == "[风险] - 反向下行风险 Alpha (252d) [Refined-Rank]"
    assert created["source"] == "MANUAL"
    assert created["lifecycle_status"] == "VERIFIED"
    assert created["direction"] == "HIGH_IS_BETTER"
    assert created["latest_diagnostic_summary"]["status"] == "COMPLETED"
    assert created["latest_diagnostic_summary"]["publish_naming_rule"] == "factor_display_name_v4"
    assert created["latest_diagnostic_summary"]["name_schema_version"] == "factor_display_name_v4"
    assert created["latest_diagnostic_summary"]["data_lineage"]["kind"] == "GOVERNANCE_REVERSE_FACTOR_PREVIEW"
    assert created["blocker_reason_summary"]["status"] in {"clear", "warning"}
    assert not any(
        item["code"] == "GROUP_RETURNS_INVERTED"
        for item in created["blocker_reason_summary"]["reasons"]
    )


def test_reverse_governance_factor_read_model_repairs_legacy_edge_fields(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    assert_ok(client.get("/factors"))
    now = "2026-05-12T09:00:00Z"
    factor_id = "m_vol_downsiderev_252d_rank"
    good_groups = [
        {"group": "Q1", "mean_return": 0.026, "sample_count": 120},
        {"group": "Q2", "mean_return": 0.015, "sample_count": 120},
        {"group": "Q3", "mean_return": 0.005, "sample_count": 120},
        {"group": "Q4", "mean_return": -0.001, "sample_count": 120},
        {"group": "Q5", "mean_return": -0.009, "sample_count": 120},
    ]
    stale_series = [
        {
            "date": f"2026-0{month}-28",
            "groups": good_groups,
            "q1_mean_return": -0.009,
            "q5_mean_return": 0.026,
            "q1_q5_spread": -0.035,
        }
        for month in range(1, 6)
    ]
    summary = {
        "run_id": "reverse-preview:fdiag_b290db5ee459",
        "factor_id": factor_id,
        "status": "PREVIEW",
        "diagnostic_mode": "VERIFIED",
        "rank_ic": 0.062,
        "ic": 0.062,
        "ir": 1.09,
        "coverage": 98.5,
        "group_returns": good_groups,
        "group_return_series": stale_series,
        "data_lineage": {"kind": "GOVERNANCE_REVERSE_FACTOR_PREVIEW", "source_factor_id": "s_vol_downside_252d_rank"},
        "compliance_trail": {"diagnosed_at": now},
    }
    with client.app.state.service.storage.connection() as conn:
        conn.execute(
            """
            INSERT INTO factor_definitions (
                id, name, market, universe, source, lifecycle_status, diagnostic_status,
                direction, frequency, expression, tags_json, data_requirements_json,
                institutional_note, created_by, created_at, updated_at
            )
            VALUES (?, '反向下行波动率代理（252日）', 'US', 'SP500', 'MANUAL', 'VERIFIED', 'COMPLETED',
                    'HIGH_IS_BETTER', 'DAILY', 'DownsideStd(Return(Close, 1), 252)', ?, ?, ?, 'factor_governance', ?, ?)
            """,
            (
                factor_id,
                dumps(["manual", "governance_optimized", "reverse_factor"]),
                dumps(["adj_close", "price_history", "returns"]),
                "治理任务生成的反向因子；来源因子持续分组收益倒挂，入库需用户二次确认。",
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO factor_versions (id, factor_id, version, expression, status, metadata_json, created_at)
            VALUES (?, ?, 1, 'DownsideStd(Return(Close, 1), 252)', 'ACTIVE', '{}', ?)
            """,
            (f"{factor_id}-v1", factor_id, now),
        )
        conn.execute(
            """
            INSERT INTO factor_diagnostic_runs (
                id, factor_id, status, dataset_snapshot_id, universe_snapshot_id,
                request_json, summary_json, artifact_refs_json, created_at, completed_at
            )
            VALUES (?, ?, 'COMPLETED', 'ds-price', 'un-sp500', '{}', ?, '{}', ?, ?)
            """,
            ("reverse-preview:fdiag_b290db5ee459", factor_id, dumps(summary), now, now),
        )

    detail = assert_ok(client.get(f"/factors/{factor_id}"))

    assert detail["latest_diagnostic_summary"]["status"] == "COMPLETED"
    assert detail["latest_diagnostic_summary"]["monotonicity"]["inverted"] is False
    assert detail["latest_diagnostic_summary"]["monotonicity"]["monotonic_good"] is True
    for row in detail["latest_diagnostic_summary"]["group_return_series"][-3:]:
        assert row["q1_mean_return"] == row["groups"][0]["mean_return"]
        assert row["q5_mean_return"] == row["groups"][-1]["mean_return"]
    assert detail["ui_state"] in {"robust", "needs_calibration"}
    assert detail["blocker_reason_summary"]["status"] in {"clear", "warning"}
    assert not any(
        item["code"] == "GROUP_RETURNS_INVERTED"
        for item in detail["blocker_reason_summary"]["reasons"]
    )


def test_size_neutralized_factor_gets_preview_and_persisted_sandbox_diagnostics(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)

    created = assert_ok(
        client.post(
            "/factors",
            json={
                "name": "6m size neutral momentum",
                "market": "US",
                "universe": "SP500",
                "expression": 'ZScore(Residual(s_mom_6m_rank, by="s_size_cur_log"))',
                "frequency": "DAILY",
                "direction": "HIGH_IS_BETTER",
                "descriptor": manual_descriptor(metric="longszneu", window="126d", operator="z"),
                "tags": ["manual"],
            },
        )
    )

    assert created["id"] == "m_mom_longszneu_126d_z"
    assert "market_cap" in created["data_requirements"]
    assert "shares_outstanding" in created["data_requirements"]

    preview = assert_ok(
        client.post(
            "/factors/diagnostics/preview",
            json={
                "batch": True,
                "factor_ids": [created["id"]],
                "diagnostic_mode": "SANDBOX",
                "include": ["ic", "ir", "groups", "turnover", "correlation", "blockers"],
            },
        )
    )
    preview_summary = preview["items"][0]["latest_diagnostic_summary"]

    assert preview_summary["status"] == "PREVIEW"
    assert isinstance(preview_summary["rank_ic"], float)
    assert preview_summary["coverage"] > 0
    assert preview_summary["data_lineage"]["kind"] == "FACTOR_EXPRESSION_PREVIEW"

    pit = assert_ok(client.get("/pit-data"))
    diagnostic = assert_ok(
        client.post(
            f"/factors/{created['id']}/diagnostics",
            json={
                "start_date": pit["diagnostic_windows"]["sandbox"]["start_date"],
                "end_date": pit["as_of_date"],
                "dataset_snapshot_id": pit["dataset_snapshot_id"],
                "universe_snapshot_id": pit["universe_snapshot_id"],
                "return_window_days": 21,
                "group_count": 5,
                "diagnostic_mode": "SANDBOX",
            },
        )
    )

    assert diagnostic["summary"]["status"] == "COMPLETED"
    assert diagnostic["summary"]["diagnostic_mode"] == "SANDBOX"
    assert isinstance(diagnostic["summary"]["rank_ic"], float)
    assert diagnostic["summary"]["coverage"] > 0

    detail = assert_ok(client.get(f"/factors/{created['id']}"))
    assert detail["latest_diagnostic_summary"]["run_id"] == diagnostic["run_id"]
    assert detail["latest_diagnostic_summary"]["factor_id"] == created["id"]


def test_factor_governance_overview_does_not_deprecate_preview_grade_d_without_persistent_inversion(tmp_path, monkeypatch):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    target_ids = {"s_liq_amihud_20d_rank", "s_mom_shortrev_1m_rank"}
    factor_service = client.app.state.service._factor_research_service()

    preview_metrics = {
        "s_liq_amihud_20d_rank": {"rank_ic": -0.0006, "ir": -0.0211, "coverage": 98.99},
        "s_mom_shortrev_1m_rank": {"rank_ic": -0.0039, "ir": -0.1232, "coverage": 98.99},
    }

    def preview_stub(request):
        payload = request if isinstance(request, dict) else request.model_dump()
        requested_ids = {str(item) for item in payload.get("factor_ids") or []}
        items = []
        for factor_id in sorted(target_ids & requested_ids):
            metrics = preview_metrics[factor_id]
            items.append(
                {
                    "factor_id": factor_id,
                    "ui_state": "decayed",
                    "ui_state_label": "失效",
                    "diagnostic_status": "SANDBOX_READY",
                    "latest_diagnostic_summary": {
                        "run_id": f"preview:{factor_id}",
                        "factor_id": factor_id,
                        "status": "PREVIEW",
                        "diagnostic_mode": "SANDBOX",
                        "data_lineage": {
                            "kind": "FACTOR_EXPRESSION_PREVIEW",
                            "note": "只读预览，不写入正式诊断表。",
                        },
                        "rank_ic": metrics["rank_ic"],
                        "ir": metrics["ir"],
                        "coverage": metrics["coverage"],
                        "group_returns": [
                            {"group": "Q1", "mean_return": 0.01, "sample_count": 50},
                            {"group": "Q5", "mean_return": 0.02, "sample_count": 50},
                        ],
                        "ic_series": [
                            {"date": f"2026-04-{day:02d}", "rank_ic": metrics["rank_ic"], "ic": metrics["rank_ic"]}
                            for day in range(1, 12)
                        ],
                        "compliance_trail": {"diagnosed_at": "2026-05-08T09:39:17Z"},
                    },
                    "batch_diagnostic_summary": {
                        "status": "PREVIEW",
                        "latest_run_id": f"preview:{factor_id}",
                        "diagnostic_mode": "SANDBOX",
                        **metrics,
                    },
                }
            )
        return {
            "mode": "BATCH",
            "status": "PREVIEW",
            "diagnostic_mode": "SANDBOX",
            "items": items,
            "batch_summary": {"factor_count": len(items), "decayed_count": len(items)},
        }

    monkeypatch.setattr(factor_service, "preview_diagnostics_batch", preview_stub)
    monkeypatch.setattr(
        factor_service,
        "_preview_diagnostics_batch_for_factors",
        lambda _factors, request: preview_stub(request),
    )

    factors = assert_ok(client.get("/factors?lifecycle=online"))["items"]
    by_id = {item["id"]: item for item in factors}
    assert target_ids.issubset(by_id)
    for factor_id in target_ids:
        assert by_id[factor_id].get("latest_diagnostic_summary") is None

    preview = assert_ok(
        client.post(
            "/factors/diagnostics/preview",
            json={
                "batch": True,
                "factor_ids": sorted(target_ids),
                "diagnostic_mode": "SANDBOX",
                "include": ["ic", "ir", "groups", "turnover", "correlation", "blockers"],
            },
        )
    )
    preview_by_id = {item["factor_id"]: item for item in preview["items"]}
    assert {item["ui_state"] for item in preview["items"]} == {"decayed"}
    assert all(item["latest_diagnostic_summary"]["status"] == "PREVIEW" for item in preview["items"])

    overview = assert_ok(client.get("/factor-governance/overview"))
    deprecate_actions = [
        action
        for action in overview["actions"]
        if action["kind"] == "DEPRECATE" and action["factor_ids"][0] in target_ids
    ]
    assert deprecate_actions == []


def test_factor_governance_prune_uses_preview_augmented_cluster_peers(tmp_path, monkeypatch):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    factor_service = client.app.state.service._factor_research_service()
    keep_id = "s_mom_6m_rank"
    prune_ids = {"s_mom_shortrev_1m_rank", "s_mom_12m1m_rank"}
    target_ids = {keep_id, *prune_ids}
    metrics_by_id = {
        keep_id: {"rank_ic": 0.028, "ir": 1.1, "coverage": 99.0},
        "s_mom_shortrev_1m_rank": {"rank_ic": 0.021, "ir": 0.42, "coverage": 97.0},
        "s_mom_12m1m_rank": {"rank_ic": 0.019, "ir": 0.35, "coverage": 96.0},
    }
    keep_series = [0.011, 0.012, 0.014, 0.017, 0.019, 0.021, 0.022, 0.024, 0.027, 0.028, 0.031]
    series_by_id = {
        keep_id: keep_series,
        "s_mom_shortrev_1m_rank": [value * 0.94 + 0.001 for value in keep_series],
        "s_mom_12m1m_rank": [value * 0.92 + 0.0015 for value in keep_series],
    }

    def preview_stub(request):
        payload = request if isinstance(request, dict) else request.model_dump()
        requested_ids = {str(item) for item in payload.get("factor_ids") or []}
        items = []
        for factor_id in sorted(target_ids & requested_ids):
            metrics = metrics_by_id[factor_id]
            items.append(
                {
                    "factor_id": factor_id,
                    "ui_state": "needs_calibration",
                    "ui_state_label": "needs calibration",
                    "diagnostic_status": "SANDBOX_READY",
                    "latest_diagnostic_summary": {
                        "run_id": f"preview:{factor_id}",
                        "factor_id": factor_id,
                        "status": "PREVIEW",
                        "diagnostic_mode": "SANDBOX",
                        "data_lineage": {"kind": "FACTOR_EXPRESSION_PREVIEW"},
                        "rank_ic": metrics["rank_ic"],
                        "ir": metrics["ir"],
                        "coverage": metrics["coverage"],
                        "group_returns": [
                            {"group": "Q1", "mean_return": 0.03, "sample_count": 50},
                            {"group": "Q5", "mean_return": 0.01, "sample_count": 50},
                        ],
                        "ic_series": [
                            {"date": f"2026-04-{index + 1:02d}", "rank_ic": value, "ic": value}
                            for index, value in enumerate(series_by_id[factor_id])
                        ],
                        "compliance_trail": {"diagnosed_at": "2026-05-08T09:39:17Z"},
                    },
                    "batch_diagnostic_summary": {
                        "status": "PREVIEW",
                        "latest_run_id": f"preview:{factor_id}",
                        "diagnostic_mode": "SANDBOX",
                        **metrics,
                    },
                    "correlation_cluster_summary": {
                        "status": "HIGH_CORRELATION",
                        "high_correlation_count": 1,
                        "top_factor_ids": [keep_id] if factor_id != keep_id else sorted(prune_ids),
                    },
                    "strategy_creation_risk": {"warning_count": 1, "hard_blocker_count": 0},
                }
            )
        return {
            "mode": "BATCH",
            "status": "PREVIEW",
            "diagnostic_mode": "SANDBOX",
            "items": items,
            "batch_summary": {"factor_count": len(items), "needs_calibration_count": len(items)},
        }

    original_cluster = factor_service._correlation_cluster

    def cluster_stub(factor_id):
        if factor_id in prune_ids:
            return {
                "anchor_factor_id": factor_id,
                "nodes": [{"factor_id": keep_id, "name": keep_id, "correlation": 0.94}],
            }
        if factor_id == keep_id:
            return {
                "anchor_factor_id": keep_id,
                "nodes": [
                    {"factor_id": prune_id, "name": prune_id, "correlation": 0.94}
                    for prune_id in sorted(prune_ids)
                ],
            }
        return original_cluster(factor_id)

    monkeypatch.setattr(factor_service, "preview_diagnostics_batch", preview_stub)
    monkeypatch.setattr(
        factor_service,
        "_preview_diagnostics_batch_for_factors",
        lambda _factors, request: preview_stub(request),
    )
    monkeypatch.setattr(factor_service, "_correlation_cluster", cluster_stub)

    online = assert_ok(client.get("/factors?lifecycle=online"))["items"]
    online_by_id = {item["id"]: item for item in online}
    assert target_ids.issubset(online_by_id)
    assert all(online_by_id[factor_id].get("latest_diagnostic_summary") is None for factor_id in target_ids)

    overview = assert_ok(client.get("/factor-governance/overview"))
    prune_actions = {
        action["factor_ids"][0]: action
        for action in overview["actions"]
        if action["kind"] == "PRUNE" and action["factor_ids"][0] in prune_ids
    }
    assert set(prune_actions) == prune_ids
    for factor_id, action in prune_actions.items():
        assert action["keep_factor_id"] == keep_id
        comparison = action["offline_detail"]["comparison"]
        assert comparison["candidate"]["factor_id"] == factor_id
        assert comparison["mvp"]["factor_id"] == keep_id
        assert comparison["mvp"]["ir"] == 1.1
        assert comparison["mvp"]["coverage"] == 99.0

    action = prune_actions["s_mom_shortrev_1m_rank"]
    executed = assert_ok(
        client.post(
            f"/factor-governance/actions/{action['id']}/execute",
            json={
                "confirm": True,
                "command": "PRUNE",
                "factor_ids": ["s_mom_shortrev_1m_rank"],
                "keep_factor_id": keep_id,
                "reason": "Preview-only cluster peer is the stronger MVP.",
                "detail": action.get("offline_detail", {}),
            },
        )
    )
    assert executed["items"][0]["lifecycle_status"] == "PRUNED"
    assert executed["items"][0]["offline_detail"]["keep_factor_id"] == keep_id


def test_factor_governance_prune_matches_factor_library_heatmap_high_pairs(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    assert_ok(client.get("/factors"))
    keep_id = "s_vol_downside_252d_rank"
    prune_id = "s_vol_mdd_252d_rank"
    keep_values = [0.012, 0.015, 0.014, 0.018, 0.021, 0.024, 0.026, 0.029, 0.031, 0.034]
    prune_values = [value * 0.91 + 0.002 for value in keep_values]
    seed_factor_diagnostic_summary(
        client,
        keep_id,
        governance_ready_summary_with_ic_series(rank_ic=0.0955, ir=2.7573, coverage=98.99, values=keep_values),
        run_id=f"fdiag_{keep_id}_mvp",
    )
    seed_factor_diagnostic_summary(
        client,
        prune_id,
        governance_ready_summary_with_ic_series(rank_ic=0.075, ir=1.0997, coverage=98.34, values=prune_values),
        run_id=f"fdiag_{prune_id}_weak",
    )

    overview = assert_ok(client.get("/factor-governance/overview"))
    action = next(
        (
            item
            for item in overview["actions"]
            if item["kind"] == "PRUNE" and item["factor_ids"] == [prune_id]
        ),
        None,
    )

    assert action is not None
    assert action["keep_factor_id"] == keep_id
    assert action["offline_detail"]["correlation"] > 0.90
    assert action["offline_detail"]["evidence_source"] == "MEASURED_DIAGNOSTIC_IC_SERIES"
    assert action["offline_detail"]["comparison"]["mvp"]["factor_id"] == keep_id


def test_factor_governance_prune_uses_standard_style_categories(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    factors = assert_ok(client.get("/factors"))["items"]
    by_id = {item["id"]: item for item in factors}
    factor_service = client.app.state.service._factor_research_service()

    assert factor_service._factor_same_prune_cluster(
        by_id["s_beta_resid_252d_z"],
        by_id["s_vol_252d_rank"],
    )
    assert factor_service._factor_same_prune_cluster(
        by_id["s_inv_assetgrowth_1y_rank"],
        by_id["s_qlty_fcfy_ttm_raw"],
    )
    assert not factor_service._factor_same_prune_cluster(
        by_id["s_liq_turnover_20d_rank"],
        by_id["s_mom_12m1m_rank"],
    )

    keep_id = "s_vol_252d_rank"
    prune_id = "s_vol_mdd_252d_rank"
    keep_values = [0.011, 0.014, 0.016, 0.017, 0.02, 0.022, 0.023, 0.027, 0.028, 0.03]
    prune_values = [value * 0.93 + 0.0008 for value in keep_values]
    seed_factor_diagnostic_summary(
        client,
        keep_id,
        governance_ready_summary_with_ic_series(rank_ic=0.075, ir=2.2, coverage=99.0, values=keep_values),
        run_id=f"fdiag_{keep_id}_style_mvp",
    )
    seed_factor_diagnostic_summary(
        client,
        prune_id,
        governance_ready_summary_with_ic_series(rank_ic=0.024, ir=0.42, coverage=91.0, values=prune_values),
        run_id=f"fdiag_{prune_id}_style_prune",
    )

    overview = assert_ok(client.get("/factor-governance/overview"))
    action = next(
        (
            item
            for item in overview["actions"]
            if item["kind"] == "PRUNE" and item["factor_ids"] == [prune_id]
        ),
        None,
    )

    assert action is not None
    assert action["keep_factor_id"] == keep_id
    assert action["offline_detail"]["comparison"]["candidate"]["factor_id"] == prune_id
    assert action["offline_detail"]["comparison"]["mvp"]["factor_id"] == keep_id


def test_factor_governance_deprecate_soft_offlines_and_blocks_model_use(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    assert_ok(client.get("/factors"))
    factor_id = "s_mom_12m1m_rank"
    seed_factor_diagnostic_summary(
        client,
        factor_id,
        {
            **governance_ready_summary(rank_ic=0.002, ir=0.12, coverage=94.0, inverted=True, low_efficiency=True),
            "group_return_series": inverted_group_return_series(),
        },
    )

    overview = assert_ok(client.get("/factor-governance/overview"))
    action = next(item for item in overview["actions"] if item["kind"] == "DEPRECATE" and factor_id in item["factor_ids"])
    rejected = client.post(
        f"/factor-governance/actions/{action['id']}/execute",
        json={
            "confirm": False,
            "command": "DEPRECATE",
            "factor_ids": [factor_id],
            "reason": "强制下线：Grade D、低效 20 个交易日且分组收益倒挂。",
        },
    )
    assert rejected.status_code == 400

    executed = assert_ok(
        client.post(
            f"/factor-governance/actions/{action['id']}/execute",
            json={
                "confirm": True,
                "command": "DEPRECATE",
                "factor_ids": [factor_id],
                "reason": "强制下线：Grade D、低效 20 个交易日且分组收益倒挂。",
                "detail": action.get("offline_detail", {}),
                "include_governance_overview": False,
            },
        )
    )
    assert executed["command"] == "DEPRECATE"
    assert executed["affected_factor_ids"] == [factor_id]
    assert "governance_overview" not in executed
    assert executed["items"][0]["lifecycle_status"] == "DEPRECATED"
    assert executed["items"][0]["offline_command"] == "DEPRECATE"
    assert executed["items"][0]["offline_at"]

    online_ids = {item["id"] for item in assert_ok(client.get("/factors?lifecycle=online"))["items"]}
    offline = assert_ok(client.get("/factors?lifecycle=offline"))
    offline_by_id = {item["id"]: item for item in offline["items"]}
    assert factor_id not in online_ids
    assert offline_by_id[factor_id]["offline_reason"].startswith("强制下线")
    assert assert_ok(client.get(f"/factors/{factor_id}"))["offline_command"] == "DEPRECATE"

    preview = assert_ok(
        client.post(
            "/factor-models/preview",
            json={
                "name": "offline factor model",
                "universe": "SP500",
                "components": [{"factor_id": factor_id, "weight": 1.0, "direction": "HIGH_IS_BETTER"}],
            },
        )
    )
    assert preview["status"] == "BLOCKED"
    blockers = preview["strategy_creation_risk"]["hard_blockers"]
    assert any(item["code"] == "FACTOR_OFFLINE" for item in blockers)
    create_response = client.post(
        "/factor-models",
        json={
            "name": "offline factor model",
            "universe": "SP500",
            "components": [{"factor_id": factor_id, "weight": 1.0, "direction": "HIGH_IS_BETTER"}],
        },
    )
    assert create_response.status_code == 400


def test_f1_raw_sources_ignore_rankic_governance_and_reject_archive_actions(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    assert_ok(client.get("/factors"))
    raw_id = "s_price_adjclose_cur_raw"
    seed_factor_diagnostic_summary(
        client,
        raw_id,
        governance_ready_summary(rank_ic=-0.019, ir=-0.12, coverage=99.2, inverted=True, low_efficiency=True),
        run_id="fdiag_raw_close_rankic_noise",
    )

    factors = assert_ok(client.get("/factors?lifecycle=all"))["items"]
    raw_factor = next(item for item in factors if item["id"] == raw_id)
    assert raw_factor["tier_level"] == "F1"
    assert raw_factor["lifecycle"] == "online"
    assert raw_factor["lifecycle_label"] == "正式诊断可用"
    assert raw_factor["ui_state"] == "robust"
    assert raw_factor["ui_state_label"] == "正式诊断可用"
    assert raw_factor["factor_level"] == "OTHER"
    assert raw_factor["factor_level_label"] == "其他"

    overview = assert_ok(client.get("/factor-governance/overview"))
    protected_actions = [
        item
        for item in overview["actions"]
        if item["kind"] in {"DEPRECATE", "PRUNE"} and raw_id in item.get("factor_ids", [])
    ]
    assert protected_actions == []

    rejected = client.post(
        f"/factor-governance/actions/gq_deprecate_{raw_id}/execute",
        json={
            "confirm": True,
            "command": "DEPRECATE",
            "factor_ids": [raw_id],
            "reason": "低 RankIC 不能成为 F1 归档原因。",
        },
    )
    assert rejected.status_code == 400
    assert "不能执行归档或冗余裁剪" in rejected.text


def test_factor_governance_suggests_l3_sa_factor_strategy_until_used_online(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    assert_ok(client.get("/factors"))

    created = assert_ok(
        client.post(
            "/factors",
            json={
                "name": "质量动量组合因子",
                "market": "US",
                "universe": "SP500",
                "expression": "Rank(s_mom_12m1m_rank + s_val_ep_ltm_raw)",
                "frequency": "DAILY",
                "direction": "HIGH_IS_BETTER",
                "descriptor": manual_descriptor(category="alpha", metric="blend", window="126d", operator="rank"),
                "tags": ["manual", "phase2_l3"],
            },
        )
    )
    factor_id = created["id"]
    storage = client.app.state.service.storage
    storage.execute(
        """
        UPDATE factor_definitions
        SET name = '质量动量组合因子',
            expression = 'ZScore(Residual(Winsorize(Rank(s_mom_12m1m_rank + s_val_ep_ltm_raw)), by=sector_beta))',
            source = 'AUTO_MINED',
            lifecycle_status = 'VERIFIED',
            diagnostic_status = 'COMPLETED'
        WHERE id = ?
        """,
        (factor_id,),
    )
    seed_factor_diagnostic_summary(
        client,
        factor_id,
        {
            **governance_ready_summary(rank_ic=0.033, ir=1.25, coverage=96.0),
            "target_layer": "L3",
        },
        run_id="fdiag_l3_sa_model_suggestion",
    )
    factor_payload = assert_ok(client.get("/factors"))
    factor_name = next(item["name"] for item in factor_payload["items"] if item["id"] == factor_id)
    expected_strategy_name = f"{factor_name}策略" if factor_name.endswith("因子") else f"{factor_name}因子策略"

    overview = assert_ok(client.get("/factor-governance/overview"))
    action = next(
        item
        for item in overview["actions"]
        if item["kind"] == "FACTOR_MODEL_SUGGESTION" and item["factor_ids"] == [factor_id]
    )
    assert action["title"] == expected_strategy_name
    assert action["suggested_weights"] == [
        {"factor_id": factor_id, "weight_pct": 100.0, "direction": "HIGH_IS_BETTER"}
    ]
    assert action["target"]["route"] == "#/factor-models/new"
    assert action["target"]["query"] == {
        "source": "governance_queue",
        "strategy_type": "COMPOSITE_FACTOR",
        "factor_id": factor_id,
        "factorIds": factor_id,
        "weights": "100",
        "directions": "HIGH_IS_BETTER",
        "modelName": expected_strategy_name,
    }

    strategy_parameters = {
        "strategy_type": "MULTI_FACTOR",
        "factor_ids": [factor_id],
        "weights": {factor_id: 100},
        "directions": {factor_id: "HIGH_IS_BETTER"},
    }
    storage.execute(
        """
        INSERT INTO strategies (
            id, name, description, strategy_type, universe_name, rebalance_frequency,
            lifecycle_status, benchmark_symbol, current_parameter_version,
            parameters_json, confirmation_fields_json, parameter_history_json,
            allowed_actions_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "strat_existing_l3_factor",
            expected_strategy_name,
            "Existing active multi-factor strategy for governance suggestion suppression.",
            "MULTI_FACTOR",
            "SP500",
            "monthly",
            "ACTIVE",
            "SPY",
            1,
            dumps(strategy_parameters),
            dumps({}),
            dumps([]),
            dumps([]),
            "2026-05-18T00:00:00Z",
            "2026-05-18T00:00:00Z",
        ),
    )
    refreshed = assert_ok(client.get("/factor-governance/overview"))
    assert not any(
        item["kind"] == "FACTOR_MODEL_SUGGESTION" and item["factor_ids"] == [factor_id]
        for item in refreshed["actions"]
    )


def test_factor_model_suggestion_skips_offline_anchor_factors(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    assert_ok(client.get("/factors"))

    storage = client.app.state.service.storage
    for factor_id in ("s_mom_12m1m_rank", "s_val_ep_ltm_raw"):
        storage.execute(
            """
            UPDATE factor_definitions
            SET lifecycle_status = 'DEPRECATED',
                offline_reason = ?,
                offline_at = ?,
                offline_command = 'DEPRECATE',
                updated_at = ?
            WHERE id = ?
            """,
            ("unit-test offline anchor", "2026-05-12T09:00:00Z", "2026-05-12T09:00:00Z", factor_id),
        )

    suggestion = assert_ok(
        client.post(
            "/factor-models/suggestions",
            json={"factor_id": "s_qlty_fcfy_ttm_raw"},
        )
    )

    action = suggestion["action"]
    assert action["factor_ids"] == [
        "s_qlty_fcfy_ttm_raw",
        "s_vol_252d_rank",
        "s_size_cur_log",
    ]
    assert action["target"]["query"]["factorIds"] == "s_qlty_fcfy_ttm_raw,s_vol_252d_rank,s_size_cur_log"
    assert action["target"]["query"]["directions"] == "HIGH_IS_BETTER,LOW_IS_BETTER,LOW_IS_BETTER"
    assert "s_mom_12m1m_rank" not in action["factor_ids"]
    assert "s_val_ep_ltm_raw" not in action["factor_ids"]


def test_factor_governance_prune_keeps_cluster_mvp_and_soft_offlines_redundant_factor(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    factors = assert_ok(client.get("/factors?lifecycle=all"))["items"]
    prune_id = "s_vol_mdd_252d_rank"
    keep_id = "s_vol_downside_252d_rank"
    assert {prune_id, keep_id}.issubset({factor["id"] for factor in factors})
    keep_values = [0.012, 0.013, 0.016, 0.017, 0.019, 0.023, 0.025, 0.027, 0.03, 0.032]
    prune_values = [value * 0.92 + 0.001 for value in keep_values]
    seed_factor_diagnostic_summary(
        client,
        prune_id,
        governance_ready_summary_with_ic_series(rank_ic=0.018, ir=0.31, coverage=82.0, values=prune_values),
        run_id=f"fdiag_{prune_id}_weak",
    )
    seed_factor_diagnostic_summary(
        client,
        keep_id,
        governance_ready_summary_with_ic_series(rank_ic=0.095, ir=5.12, coverage=99.0, values=keep_values),
        run_id=f"fdiag_{keep_id}_mvp",
    )

    overview = assert_ok(client.get("/factor-governance/overview"))
    action = next(item for item in overview["actions"] if item["kind"] == "PRUNE" and prune_id in item["factor_ids"])
    factor_by_id = {item["id"]: item for item in factors}
    assert action["keep_factor_id"] == keep_id
    comparison = action["offline_detail"]["comparison"]
    assert comparison["candidate"]["factor_id"] == prune_id
    assert comparison["candidate"]["factor_name"] == factor_by_id[prune_id]["name"]
    assert comparison["candidate"]["rank_ic"] == 0.018
    assert comparison["candidate"]["ir"] == 0.31
    assert comparison["candidate"]["coverage"] == 82.0
    assert comparison["mvp"]["factor_id"] == keep_id
    assert comparison["mvp"]["factor_name"] == factor_by_id[keep_id]["name"]
    assert comparison["mvp"]["rank_ic"] == 0.095
    assert comparison["mvp"]["ir"] == 5.12
    assert comparison["mvp"]["coverage"] == 99.0
    expected_reason = f"冗余裁剪：同簇高相关且弱于{factor_by_id[keep_id]['name']}"
    assert action["offline_reason"] == expected_reason
    executed = assert_ok(
        client.post(
            f"/factor-governance/actions/{action['id']}/execute",
            json={
                "confirm": True,
                "command": "PRUNE",
                "factor_ids": [prune_id],
                "keep_factor_id": keep_id,
                "reason": expected_reason,
                "detail": action.get("offline_detail", {}),
            },
        )
    )
    assert executed["command"] == "PRUNE"
    assert executed["keep_factor_id"] == keep_id
    offline = assert_ok(client.get("/factors?lifecycle=offline"))["items"]
    offline_by_id = {item["id"]: item for item in offline}
    assert offline_by_id[prune_id]["lifecycle_status"] == "PRUNED"
    assert offline_by_id[prune_id]["offline_reason"] == expected_reason
    assert offline_by_id[prune_id]["offline_detail"]["keep_factor_id"] == keep_id
    online_ids = {item["id"] for item in assert_ok(client.get("/factors?lifecycle=online"))["items"]}
    assert keep_id in online_ids
    assert prune_id not in online_ids


def test_factor_governance_prune_execute_is_idempotent_for_stale_confirmation(tmp_path):
    client, db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client, oscillating=True)
    for expected_id, name, expression, descriptor in [
        (
            "m_liq_pvdiv_10d_raw",
            "价量背离因子",
            "Correlation(Rank(Close), Rank(Volume), 10)",
            manual_descriptor(category="liq", metric="pvdiv", window="10d", operator="raw"),
        ),
            (
                "m_liq_vol_conc_21d_raw",
                "量能汇聚因子",
                "Correlation(Rank(Volume), Rank(Abs(Return(Close,1))),21)",
                manual_descriptor(category="liq", metric="vol_conc", window="21d", operator="raw"),
            ),
    ]:
        created = assert_ok(
            client.post(
                "/factors",
                json={
                    "name": name,
                    "market": "US",
                    "universe": "SP500",
                    "expression": expression,
                    "description": name,
                    "frequency": "DAILY",
                    "direction": "HIGH_IS_BETTER",
                    "descriptor": descriptor,
                    "tags": ["manual", "factor_zoo"],
                },
            )
        )
        assert created["id"] == expected_id
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE factor_definitions SET lifecycle_status = 'VERIFIED' WHERE id IN (?, ?)",
            ("m_liq_pvdiv_10d_raw", "m_liq_vol_conc_21d_raw"),
        )
    keep_values = [0.01, 0.012, 0.014, 0.017, 0.018, 0.021, 0.023, 0.026, 0.027, 0.029]
    prune_values = [value * 0.94 + 0.0007 for value in keep_values]
    seed_factor_diagnostic_summary(
        client,
        "m_liq_pvdiv_10d_raw",
        governance_ready_summary_with_ic_series(
            rank_ic=0.021,
            ir=0.8,
            coverage=98.99,
            values=prune_values,
        ),
        run_id="fdiag_m_liq_pvdiv_10d_raw_weak",
    )
    seed_factor_diagnostic_summary(
        client,
        "m_liq_vol_conc_21d_raw",
        governance_ready_summary_with_ic_series(
            rank_ic=0.0253,
            ir=1.0171,
            coverage=98.99,
            values=keep_values,
        ),
        run_id="fdiag_m_liq_vol_conc_21d_raw_mvp",
    )

    overview = assert_ok(client.get("/factor-governance/overview"))
    action = next(item for item in overview["actions"] if item["id"] == "gq_prune_m_liq_pvdiv_10d_raw")
    payload = {
        "confirm": True,
        "command": "PRUNE",
        "factor_ids": ["m_liq_pvdiv_10d_raw"],
        "keep_factor_id": action["keep_factor_id"],
        "reason": action["offline_reason"],
        "detail": action.get("offline_detail", {}),
    }

    executed = assert_ok(client.post(f"/factor-governance/actions/{action['id']}/execute", json=payload))
    replayed = assert_ok(client.post(f"/factor-governance/actions/{action['id']}/execute", json=payload))

    assert executed["command"] == "PRUNE"
    assert replayed["command"] == "PRUNE"
    assert replayed["keep_factor_id"] == "m_liq_vol_conc_21d_raw"
    assert replayed["affected_factor_ids"] == ["m_liq_pvdiv_10d_raw"]
    assert replayed["items"][0]["lifecycle_status"] == "PRUNED"
    assert all(item["id"] != action["id"] for item in replayed["governance_overview"]["actions"])


def test_factor_governance_prune_recovery_restores_heuristic_only_factor(tmp_path):
    client, db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    factor_id = "s_vol_mdd_252d_rank"
    keep_id = "s_vol_downside_252d_rank"
    assert_ok(client.get("/factors"))
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            UPDATE factor_definitions
            SET lifecycle_status = 'PRUNED',
                offline_reason = ?,
                offline_at = '2026-05-20T00:00:00Z',
                offline_command = 'PRUNE',
                offline_detail_json = ?,
                updated_at = '2026-05-20T00:00:00Z'
            WHERE id = ?
            """,
            (
                "冗余裁剪：历史启发式相关性",
                dumps(
                    {
                        "keep_factor_id": keep_id,
                        "correlation": 0.94,
                        "evidence_source": "FACTOR_LIBRARY_HEATMAP_PROXY",
                    }
                ),
                factor_id,
            ),
        )

    preview = assert_ok(client.get("/factor-governance/prune-recovery/preview"))
    item = next(entry for entry in preview["items"] if entry["factor_id"] == factor_id)
    assert item["recoverable"] is True
    assert item["decision"] == "RESTORE"
    assert item["offline_correlation"] == 0.94
    assert item["measured_correlation"] == 0.0

    applied = assert_ok(
        client.post(
            "/factor-governance/prune-recovery/apply",
            json={"confirm": True, "factor_ids": [factor_id], "reason": "unit-test recovery"},
        )
    )

    assert applied["command"] == "PRUNE_RECOVERY"
    assert applied["recovered_factor_ids"] == [factor_id]
    recovered = assert_ok(client.get(f"/factors/{factor_id}"))
    assert recovered["lifecycle_status"] == "VERIFIED"
    assert recovered["offline_reason"] is None
    assert recovered["offline_command"] is None
    assert recovered["offline_detail"] == {}
    with sqlite3.connect(db_path) as conn:
        event = conn.execute(
            """
            SELECT event_type, before_json, after_json
            FROM factor_governance_events
            WHERE factor_id = ? AND event_type = 'PRUNE_RECOVERY'
            """,
            (factor_id,),
        ).fetchone()
    assert event is not None
    assert json.loads(event[1])["recovery_evidence"]["decision"] == "RESTORE"
    assert json.loads(event[2])["reason"] == "unit-test recovery"


def test_factor_governance_prune_recovery_keeps_factor_pruned_with_real_evidence(tmp_path):
    client, db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    factor_id = "s_vol_mdd_252d_rank"
    keep_id = "s_vol_252d_rank"
    assert_ok(client.get("/factors"))
    now = "2026-05-20T00:00:00Z"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            UPDATE factor_definitions
            SET lifecycle_status = 'PRUNED',
                offline_reason = ?,
                offline_at = ?,
                offline_command = 'PRUNE',
                offline_detail_json = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                "冗余裁剪：检疫实测相关性",
                now,
                dumps({"keep_factor_id": keep_id, "correlation": 0.94}),
                now,
                factor_id,
            ),
        )
        conn.execute(
            """
            INSERT INTO factor_quarantine_candidates (
                id,
                mining_candidate_id,
                source_mining_job_id,
                expression,
                status,
                publish_status,
                gate_summary_json,
                cluster_id,
                candidate_metrics_json,
                failure_samples_json,
                pit_evidence_json,
                publish_eligibility_json,
                target_factor_id,
                created_at,
                updated_at,
                published_at,
                rejected_reason
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "fq_redundancy_real_evidence",
                "mine_redundancy_real_evidence",
                "mine_redundancy_real",
                "ZScore(Residual(Return(Close, 252), by=\"s_vol_252d_rank\"))",
                "PASSED",
                "ELIGIBLE",
                dumps({"redundancy_pruning": "FAILED"}),
                "cluster_redundancy_real",
                dumps({"matrix_max_correlation": 0.93, "rank_ic": 0.041}),
                dumps([]),
                dumps({"status": "FULL_READY"}),
                dumps({"status": "ELIGIBLE"}),
                factor_id,
                now,
                now,
                now,
                None,
            ),
        )

    preview = assert_ok(client.get("/factor-governance/prune-recovery/preview"))
    item = next(entry for entry in preview["items"] if entry["factor_id"] == factor_id)
    assert item["recoverable"] is False
    assert item["decision"] == "KEEP_PRUNED"
    assert item["measured_correlation"] == 0.93
    assert item["evidence"]["quarantine"]["evidence_source"] == "QUARANTINE_GATE"

    applied = assert_ok(
        client.post(
            "/factor-governance/prune-recovery/apply",
            json={"confirm": True, "factor_ids": [factor_id], "reason": "unit-test non recovery"},
        )
    )
    assert applied["recovered_factor_ids"] == []
    assert applied["recovered_count"] == 0
    still_pruned = assert_ok(client.get(f"/factors/{factor_id}"))
    assert still_pruned["lifecycle_status"] == "PRUNED"


def test_factor_governance_prune_recovery_restores_different_operator_status_light(tmp_path):
    client, db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    keep_id = "m_mom_recoverylight_21d_raw"
    pruned_id = "m_mom_recoverylight_21d_rank"
    for expected_id, name, expression, operator in [
        (keep_id, "recovery light raw return", "Return(Close, 21)", "raw"),
        (
            pruned_id,
            "recovery light refined return",
            "ZScore(Rank(Return(Close, 21)))",
            "rank",
        ),
    ]:
        created = assert_ok(
            client.post(
                "/factors",
                json={
                    "name": name,
                    "market": "US",
                    "universe": "SP500",
                    "expression": expression,
                    "frequency": "DAILY",
                    "direction": "HIGH_IS_BETTER",
                    "descriptor": manual_descriptor(metric="recoverylight", window="21d", operator=operator),
                    "tags": ["manual"],
                },
            )
        )
        assert created["id"] == expected_id
    keep_values = [0.011, 0.013, 0.015, 0.018, 0.017, 0.021, 0.024, 0.026, 0.025, 0.029]
    pruned_values = [value * 0.94 + 0.001 for value in keep_values]
    seed_factor_diagnostic_summary(
        client,
        keep_id,
        governance_ready_summary_with_ic_series(rank_ic=0.034, ir=1.6, coverage=99.1, values=keep_values),
        run_id="fdiag_recovery_light_keep",
    )
    seed_factor_diagnostic_summary(
        client,
        pruned_id,
        governance_ready_summary_with_ic_series(rank_ic=0.028, ir=1.1, coverage=98.4, values=pruned_values),
        run_id="fdiag_recovery_light_pruned",
    )
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            UPDATE factor_definitions
            SET lifecycle_status = 'PRUNED',
                offline_reason = 'historical redundancy prune across status lights',
                offline_at = '2026-05-20T00:00:00Z',
                offline_command = 'PRUNE',
                offline_detail_json = ?,
                updated_at = '2026-05-20T00:00:00Z'
            WHERE id = ?
            """,
            (
                dumps(
                    {
                        "keep_factor_id": keep_id,
                        "correlation": 0.94,
                        "evidence_source": "MEASURED_DIAGNOSTIC_IC_SERIES",
                    }
                ),
                pruned_id,
            ),
        )

    preview = assert_ok(client.get("/factor-governance/prune-recovery/preview"))
    item = next(entry for entry in preview["items"] if entry["factor_id"] == pruned_id)
    assert item["recoverable"] is True
    assert item["decision"] == "RESTORE"
    assert item["reason"] == "operator_status_light_mismatch"
    assert item["evidence"]["operator_status_light"]["same"] is False

    applied = assert_ok(
        client.post(
            "/factor-governance/prune-recovery/apply",
            json={"confirm": True, "factor_ids": [pruned_id], "reason": "unit-test status light recovery"},
        )
    )

    assert applied["recovered_factor_ids"] == [pruned_id]
    restored = assert_ok(client.get(f"/factors/{pruned_id}"))
    assert restored["lifecycle_status"] == "VERIFIED"
    assert restored["offline_reason"] is None
    assert restored["offline_command"] is None


def test_factor_governance_redundancy_restore_queue_restores_only_best_candidate(tmp_path):
    client, db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    source_id = "s_vol_downside_252d_rank"
    weaker_id = "s_vol_mdd_252d_rank"
    best_id = "s_vol_252d_rank"
    assert_ok(client.get("/factors?lifecycle=all"))
    seed_factor_diagnostic_summary(
        client,
        source_id,
        governance_ready_summary(rank_ic=0.006, ir=0.21, coverage=92.0),
        run_id="fdiag_restore_source_weak",
    )
    seed_factor_diagnostic_summary(
        client,
        weaker_id,
        governance_ready_summary(rank_ic=0.024, ir=1.1, coverage=97.0),
        run_id="fdiag_restore_weaker",
    )
    seed_factor_diagnostic_summary(
        client,
        best_id,
        governance_ready_summary(rank_ic=0.041, ir=2.5, coverage=99.0),
        run_id="fdiag_restore_best",
    )
    with sqlite3.connect(db_path) as conn:
        for factor_id in (weaker_id, best_id):
            conn.execute(
                """
                UPDATE factor_definitions
                SET lifecycle_status = 'PRUNED',
                    offline_reason = 'historical redundancy prune',
                    offline_at = '2026-05-20T00:00:00Z',
                    offline_command = 'PRUNE',
                    offline_detail_json = ?,
                    updated_at = '2026-05-20T00:00:00Z'
                WHERE id = ?
                """,
                (
                    dumps(
                        {
                            "keep_factor_id": source_id,
                            "correlation": 0.94,
                            "evidence_source": "FACTOR_LIBRARY_HEATMAP_PROXY",
                        }
                    ),
                    factor_id,
                ),
            )

    overview = assert_ok(client.get("/factor-governance/overview"))
    restore_actions = [
        item for item in overview["actions"]
        if item.get("kind") == "REDUNDANCY_RESTORE"
    ]
    assert len(restore_actions) == 1
    action = restore_actions[0]
    assert action["command"] == "RESTORE_PRUNED"
    assert action["restore_factor_id"] == best_id
    assert action["affected_factor_ids"] == [best_id]
    assert action["criteria"]["selection"] == "highest_factor_level_then_lifecycle"

    executed = assert_ok(
        client.post(
            f"/factor-governance/actions/{action['id']}/execute",
            json={
                "confirm": True,
                "command": "RESTORE_PRUNED",
                "factor_ids": action["affected_factor_ids"],
                "keep_factor_id": action["keep_factor_id"],
                "reason": "unit-test restore best only",
                "detail": action.get("offline_detail", {}),
            },
        )
    )

    assert executed["command"] == "RESTORE_PRUNED"
    assert executed["affected_factor_ids"] == [best_id]
    restored = assert_ok(client.get(f"/factors/{best_id}"))
    assert restored["lifecycle_status"] == "VERIFIED"
    assert restored["offline_reason"] is None
    assert restored["offline_command"] is None
    still_pruned = assert_ok(client.get(f"/factors/{weaker_id}"))
    assert still_pruned["lifecycle_status"] == "PRUNED"
    with sqlite3.connect(db_path) as conn:
        event = conn.execute(
            """
            SELECT event_type, after_json
            FROM factor_governance_events
            WHERE factor_id = ? AND event_type = 'REDUNDANCY_RESTORE'
            """,
            (best_id,),
        ).fetchone()
    assert event is not None
    assert json.loads(event[1])["reason"] == "unit-test restore best only"


def test_factor_diagnostics_returns_redundancy_restore_followup(tmp_path):
    client, db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    pit = assert_ok(client.get("/pit-data"))
    source_id = "s_vol_downside_252d_rank"
    target_id = "s_vol_252d_rank"
    assert_ok(client.get("/factors?lifecycle=all"))
    seed_factor_diagnostic_summary(
        client,
        target_id,
        governance_ready_summary(rank_ic=0.041, ir=2.5, coverage=99.0),
        run_id="fdiag_restore_followup_target",
    )
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            UPDATE factor_definitions
            SET lifecycle_status = 'PRUNED',
                offline_reason = 'historical redundancy prune',
                offline_at = '2026-05-20T00:00:00Z',
                offline_command = 'PRUNE',
                offline_detail_json = ?,
                updated_at = '2026-05-20T00:00:00Z'
            WHERE id = ?
            """,
            (
                dumps({"keep_factor_id": source_id, "correlation": 0.94}),
                target_id,
            ),
        )
    factor_service = client.app.state.service._factor_research_service()
    original_compute = factor_service._compute_factor_diagnostic_summary

    def fake_compute_summary(**kwargs):
        run_id = kwargs["run_id"]
        summary = governance_ready_summary(rank_ic=0.006, ir=0.21, coverage=92.0)
        return {
            **summary,
            "run_id": run_id,
            "factor_id": source_id,
            "dataset_snapshot_id": pit["dataset_snapshot_id"],
            "universe_snapshot_id": pit["universe_snapshot_id"],
            "artifact_refs": {},
            "promotion_eligible": True,
        }

    factor_service._compute_factor_diagnostic_summary = fake_compute_summary
    try:
        diagnostic = assert_ok(
            client.post(
                f"/factors/{source_id}/diagnostics",
                json={
                    "start_date": pit["diagnostic_windows"]["verified"]["start_date"],
                    "end_date": pit["as_of_date"],
                    "dataset_snapshot_id": pit["dataset_snapshot_id"],
                    "universe_snapshot_id": pit["universe_snapshot_id"],
                    "return_window_days": 21,
                    "group_count": 5,
                    "diagnostic_mode": "VERIFIED",
                },
            )
        )
    finally:
        factor_service._compute_factor_diagnostic_summary = original_compute

    followups = diagnostic.get("governance_followups") or []
    assert any(
        item.get("command") == "RESTORE_PRUNED"
        and item.get("restore_factor_id") == target_id
        for item in followups
    )


def test_factor_batch_preview_is_read_only_and_returns_summary(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    before_runs = client.app.state.service.storage.fetch_one(
        "SELECT COUNT(*) AS count FROM factor_diagnostic_runs"
    )["count"]

    preview = assert_ok(
        client.post(
            "/factors/diagnostics/preview",
            json={
                "batch": True,
                "factor_ids": ["s_mom_12m1m_rank", "s_val_ep_ltm_raw"],
                "diagnostic_mode": "SANDBOX",
                "include": ["ic", "ir", "groups", "turnover", "correlation", "blockers"],
            },
        )
    )
    after_runs = client.app.state.service.storage.fetch_one(
        "SELECT COUNT(*) AS count FROM factor_diagnostic_runs"
    )["count"]

    assert preview["mode"] == "BATCH"
    assert preview["batch_summary"]["factor_count"] == 2
    assert preview["batch_summary"]["warning_count"] >= 0
    assert preview["batch_summary"]["blocked_count"] >= 0
    assert {item["factor_id"] for item in preview["items"]} == {"s_mom_12m1m_rank", "s_val_ep_ltm_raw"}
    assert all("strategy_creation_risk" in item for item in preview["items"])
    assert all(item["latest_diagnostic_summary"]["status"] == "PREVIEW" for item in preview["items"])
    assert all(item["latest_diagnostic_summary"]["data_lineage"]["kind"] == "FACTOR_EXPRESSION_PREVIEW" for item in preview["items"])
    assert after_runs == before_runs


def test_factor_batch_preview_hot_cache_reuses_loaded_pit_frame(tmp_path, monkeypatch):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    factor_service = client.app.state.service._factor_research_service()
    original_loader = factor_service._load_diagnostic_price_bars
    load_calls = 0

    def counted_loader(*args, **kwargs):
        nonlocal load_calls
        load_calls += 1
        return original_loader(*args, **kwargs)

    monkeypatch.setattr(factor_service, "_load_diagnostic_price_bars", counted_loader)
    request_payload = {
        "batch": True,
        "factor_ids": ["s_mom_12m1m_rank", "s_val_ep_ltm_raw"],
        "diagnostic_mode": "SANDBOX",
        "include": ["ic", "ir", "groups", "turnover", "correlation", "blockers"],
    }

    first = assert_ok(client.post("/factors/diagnostics/preview", json=request_payload))
    second = assert_ok(client.post("/factors/diagnostics/preview", json=request_payload))

    assert load_calls == 1
    assert second["batch_summary"] == first["batch_summary"]
    assert second["items"] == first["items"]


def test_factor_formal_diagnostics_hot_cache_still_writes_new_runs(tmp_path, monkeypatch):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    pit = assert_ok(client.get("/pit-data"))
    factor_service = client.app.state.service._factor_research_service()
    original_loader = factor_service._load_diagnostic_price_bars
    original_observations = factor_service._diagnostic_observations
    original_validator = factor_service._validate_diagnostic_snapshot_binding
    load_calls = 0
    observation_calls = 0
    validation_calls = 0

    def counted_loader(*args, **kwargs):
        nonlocal load_calls
        load_calls += 1
        return original_loader(*args, **kwargs)

    def counted_observations(*args, **kwargs):
        nonlocal observation_calls
        observation_calls += 1
        return original_observations(*args, **kwargs)

    def counted_validator(*args, **kwargs):
        nonlocal validation_calls
        validation_calls += 1
        return original_validator(*args, **kwargs)

    monkeypatch.setattr(factor_service, "_load_diagnostic_price_bars", counted_loader)
    monkeypatch.setattr(factor_service, "_diagnostic_observations", counted_observations)
    monkeypatch.setattr(factor_service, "_validate_diagnostic_snapshot_binding", counted_validator)
    verified_window = pit["diagnostic_windows"]["verified"]
    request_payload = {
        "start_date": verified_window["start_date"],
        "end_date": verified_window["end_date"],
        "dataset_snapshot_id": pit["dataset_snapshot_id"],
        "universe_snapshot_id": pit["universe_snapshot_id"],
        "return_window_days": 21,
        "group_count": 5,
        "diagnostic_mode": "VERIFIED",
    }

    first = assert_ok(client.post("/factors/s_mom_12m1m_rank/diagnostics", json=request_payload))
    second = assert_ok(client.post("/factors/s_mom_12m1m_rank/diagnostics", json=request_payload))

    assert load_calls == 1
    assert observation_calls == 1
    assert validation_calls == 1
    assert first["run_id"] != second["run_id"]
    assert first["summary"]["status"] == "COMPLETED"
    assert second["summary"]["status"] == "COMPLETED"
    rows = client.app.state.service.storage.fetch_all(
        "SELECT id, request_json FROM factor_diagnostic_runs WHERE id IN (?, ?) ORDER BY created_at",
        (first["run_id"], second["run_id"]),
    )
    rows_by_id = {row["id"]: row for row in rows}
    assert set(rows_by_id) == {first["run_id"], second["run_id"]}
    for row in rows_by_id.values():
        stored_request = json.loads(row["request_json"])
        assert stored_request["diagnostic_mode"] == "VERIFIED"
        assert stored_request["dataset_snapshot_id"] == pit["dataset_snapshot_id"]
        assert stored_request["universe_snapshot_id"] == pit["universe_snapshot_id"]


def test_published_quarantine_factor_diagnostic_reuses_summary_when_replay_sample_is_short(tmp_path, monkeypatch):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    pit = assert_ok(client.get("/pit-data"))
    assert_ok(client.get("/factors"))
    storage = client.app.state.service.storage
    factor_id = "a_alpha_custom_cur_raw"
    source_run_id = f"fdiag_{factor_id}_legacy_publish"
    now = "2026-05-19T10:30:00Z"
    with storage.connection() as conn:
        conn.execute(
            """
            INSERT OR REPLACE INTO factor_definitions (
                id, name, market, universe, source, lifecycle_status, diagnostic_status,
                direction, frequency, expression, tags_json, data_requirements_json,
                institutional_note, created_by, created_at, updated_at
            )
            VALUES (?, 'Legacy value volatility ratio', 'US', 'SP500', 'AUTO_MINED',
                    'VERIFIED', 'COMPLETED', 'HIGH_IS_BETTER', 'DAILY', ?, ?, ?, ?,
                    'unit_test', ?, ?)
            """,
            (
                factor_id,
                "s_val_cfp_ltm_raw / s_vol_downside_252d_rank",
                dumps(["auto_mined", "quarantine_publish", "L3"]),
                dumps(["adj_close", "price_history", "returns", "market_cap", "operating_cash_flow"]),
                "Legacy auto-mined value-volatility factor.",
                now,
                now,
            ),
        )
    seed_factor_diagnostic_summary(
        client,
        factor_id,
        {
            **governance_ready_summary(rank_ic=0.3455, ir=6.91, coverage=100.0),
            "target_layer": "L3",
            "promotion_eligible": True,
            "group_return_series": [
                {
                    "date": f"2026-0{month}-20",
                    "groups": [
                        {"group": "Q1", "mean_return": 0.024 + month * 0.001, "sample_count": 120},
                        {"group": "Q5", "mean_return": -0.019 - month * 0.001, "sample_count": 120},
                    ],
                    "q1_q5_spread": 0.043 + month * 0.002,
                }
                for month in range(1, 7)
            ],
            "scoring_detail": {
                "risk_orthogonality": {
                    "incremental_ir": 0.5527,
                    "max_drawdown": 45.53,
                    "style_corr": 0.26,
                },
                "stability_turnover": {"turnover_rate_weekly": 18.0},
                "data_health": {"coverage": 100.0},
            },
            "data_lineage": {
                "kind": "QUARANTINE_PUBLISH_SUMMARY",
                "method": "factor_quarantine_run_metrics",
            },
        },
        run_id=source_run_id,
    )
    factor_service = client.app.state.service._factor_research_service()

    def fake_data_cache(**_kwargs):
        return {
            "symbols": ["AAPL", "MSFT", "NVDA", "AMZN"],
            "bars_by_symbol": {},
            "fundamental_by_symbol": {},
            "prepared_frame": {},
        }

    def sample_shortage(**_kwargs):
        raise ValueError("diagnostic sample shortage: IC sample insufficient")

    monkeypatch.setattr(factor_service, "_build_diagnostic_batch_data_cache", fake_data_cache)
    monkeypatch.setattr(factor_service, "_compute_factor_diagnostic_summary", sample_shortage)
    verified_window = pit["diagnostic_windows"]["verified"]

    diagnostic = assert_ok(
        client.post(
            f"/factors/{factor_id}/diagnostics",
            json={
                "start_date": verified_window["start_date"],
                "end_date": pit["as_of_date"],
                "dataset_snapshot_id": pit["dataset_snapshot_id"],
                "universe_snapshot_id": pit["universe_snapshot_id"],
                "return_window_days": 21,
                "group_count": 5,
                "diagnostic_mode": "VERIFIED",
            },
        )
    )

    assert diagnostic["run_id"] != source_run_id
    assert diagnostic["summary"]["run_id"] == diagnostic["run_id"]
    assert diagnostic["summary"]["status"] == "COMPLETED"
    assert diagnostic["summary"]["rank_ic"] == 0.3455
    assert diagnostic["summary"]["published_diagnostic_reused"] is True
    assert diagnostic["summary"]["source_diagnostic_run_id"] == source_run_id
    assert diagnostic["summary"]["diagnostic_reuse"]["kind"] == "PUBLISHED_QUARANTINE_SUMMARY"
    assert diagnostic["summary"]["data_lineage"]["kind"] == "QUARANTINE_PUBLISH_SUMMARY"
    assert diagnostic["summary"]["ir"] == 6.91
    assert diagnostic["summary"]["ir_reference_only"] is True
    assert diagnostic["summary"]["ir_display_value"] is None
    assert diagnostic["summary"]["ir_evidence"]["value"] == 6.91
    assert diagnostic["summary"]["ir_evidence"]["display_value"] is None
    assert diagnostic["summary"]["ir_evidence"]["reference_only"] is True
    row = storage.fetch_one(
        "SELECT request_json, summary_json FROM factor_diagnostic_runs WHERE id = ?",
        (diagnostic["run_id"],),
    )
    stored_request = json.loads(row["request_json"])
    stored_summary = json.loads(row["summary_json"])
    assert stored_request["diagnostic_mode"] == "VERIFIED"
    assert stored_summary["source_diagnostic_run_id"] == source_run_id

    factors = assert_ok(client.get("/factors"))
    item = next(item for item in factors["items"] if item["id"] == factor_id)
    assert item["latest_diagnostic_summary"]["ir"] == 6.91
    assert item["latest_diagnostic_summary"]["ir_reference_only"] is True
    assert item["quality_view"]["ir"] is None
    assert item["quality_view"]["raw_ir"] == 6.91
    assert item["quality_view"]["ir_reference_only"] is True
    assert item["diagnostic_gap_summary"]["next_action"] == "IC_IR: 样本不足，待正式重算"
    assert item["factor_level"] != "S"
    composite = item["composite_view"]
    assert composite["quality"]["sharpe"] == 0.553
    assert composite["source"]["sharpe_source"] == "quarantine_incremental_ir_proxy"
    assert composite["source"]["sharpe_observation_count"] == 6
    assert "incremental IR proxy" in composite["source"]["sharpe_shortfall_reason"]


def test_factor_batch_preview_skips_governance_queue_build(tmp_path, monkeypatch):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    factor_service = client.app.state.service._factor_research_service()

    def fail_governance_action(*_args, **_kwargs):
        raise AssertionError("preview hot path must not build governance actions")

    monkeypatch.setattr(factor_service, "_governance_action_from_factor", fail_governance_action)

    preview = assert_ok(
        client.post(
            "/factors/diagnostics/preview",
            json={
                "batch": True,
                "factor_ids": ["s_mom_12m1m_rank", "s_val_ep_ltm_raw"],
                "diagnostic_mode": "SANDBOX",
                "include": ["ic", "ir", "groups", "turnover", "correlation", "blockers"],
            },
        )
    )

    assert preview["mode"] == "BATCH"
    assert {item["factor_id"] for item in preview["items"]} == {"s_mom_12m1m_rank", "s_val_ep_ltm_raw"}


def test_factor_list_uses_lightweight_governance_queue_count(tmp_path, monkeypatch):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    factor_service = client.app.state.service._factor_research_service()

    def fail_governance_action(*_args, **_kwargs):
        raise AssertionError("factor list should expose only lightweight queue count")

    monkeypatch.setattr(factor_service, "_governance_action_from_factor", fail_governance_action)

    payload = assert_ok(client.get("/factors?lifecycle=online"))

    assert payload["items"]
    assert "governance_queue_count" in payload["summary"]


def test_manual_factor_validation_and_pit_bound_diagnostics(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    pit = assert_ok(client.get("/pit-data"))

    invalid = client.post(
        "/factors",
        json={
            "name": "危险公式",
            "market": "US",
            "universe": "SP500",
            "expression": "Eval(Close)",
            "frequency": "DAILY",
            "direction": "HIGH_IS_BETTER",
            "descriptor": manual_descriptor(metric="unsafe"),
            "tags": ["测试"],
        },
    )
    assert invalid.status_code == 400

    for descriptor in (
        {**manual_descriptor(), "source_prefix": "x"},
        {**manual_descriptor(), "category": "unknown"},
        {**manual_descriptor(), "operator": "pct"},
    ):
        rejected = client.post(
            "/factors",
            json={
                "name": "非法描述符",
                "market": "US",
                "universe": "SP500",
                "expression": "Rank(Delta(Close, 5))",
                "frequency": "DAILY",
                "direction": "HIGH_IS_BETTER",
                "descriptor": descriptor,
                "tags": ["测试"],
            },
        )
        assert rejected.status_code == 400

    created = assert_ok(
        client.post(
            "/factors",
            json={
                "name": "5日动量",
                "market": "US",
                "universe": "SP500",
                "expression": "Rank(Delta(Close, 5))",
                "frequency": "DAILY",
                "direction": "HIGH_IS_BETTER",
                "descriptor": manual_descriptor(),
                "tags": ["人工"],
            },
        )
    )
    assert created["source"] == "MANUAL"
    assert created["id"] == "m_mom_short_5d_rank"
    assert created["descriptor"]["canonical_id"] == "m_mom_short_5d_rank"

    duplicate = client.post(
        "/factors",
        json={
            "name": "重复 5日动量",
            "market": "US",
            "universe": "SP500",
            "expression": "Rank(Delta(Close, 10))",
            "frequency": "DAILY",
            "direction": "HIGH_IS_BETTER",
            "descriptor": manual_descriptor(),
            "tags": ["人工"],
        },
    )
    assert duplicate.status_code == 409
    assert "m_mom_short_5d_rank" in duplicate.json()["message"]

    result = assert_ok(
        client.post(
            f"/factors/{created['id']}/diagnostics",
            json={
                "start_date": "2023-01-03",
                "end_date": pit["as_of_date"],
                "dataset_snapshot_id": pit["dataset_snapshot_id"],
                "universe_snapshot_id": pit["universe_snapshot_id"],
                "return_window_days": 21,
                "group_count": 5,
            },
        )
    )
    assert result["run_id"].startswith("fdiag_")
    assert result["summary"]["dataset_snapshot_id"] == "ds-price"
    assert result["summary"]["universe_snapshot_id"] == "un-sp500"
    assert result["summary"]["diagnostic_mode"] == "VERIFIED"
    assert result["summary"]["coverage"] > 0


def test_factor_diagnostic_uses_global_calendar_for_staggered_symbol_history(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    factor_service = client.app.state.service._factor_research_service()
    symbols = [f"T{i:03d}" for i in range(200)]
    days = _business_days(date(2020, 1, 2), 180)
    bars_by_symbol = {}
    for symbol_index, symbol in enumerate(symbols):
        offset = symbol_index % 7
        price = 100.0 + symbol_index * 0.1
        rows = []
        for day_index, current_day in enumerate(days[offset:]):
            price = round(price * (1.0 + 0.0004 + (day_index % 5) * 0.0001), 4)
            rows.append(
                {
                    "date": current_day.isoformat(),
                    "open": price * 0.999,
                    "high": price * 1.002,
                    "low": price * 0.998,
                    "close": price,
                    "adj_close": price,
                    "volume": 1_000_000 + day_index,
                }
            )
        bars_by_symbol[symbol] = rows

    observations, _series_by_symbol, requested_symbols = factor_service._diagnostic_observations(
        factor_id="m_test_global_calendar_1d_raw",
        expression="Return(Close,1)",
        direction="HIGH_IS_BETTER",
        descriptor={"operator": "raw"},
        dataset_snapshot_id="ds-price",
        fundamental_snapshot_id="ds-fundamentals",
        universe_snapshot_id="un-sp500",
        start_date=days[21].isoformat(),
        end_date=days[-22].isoformat(),
        return_window_days=21,
        symbols_override=symbols,
        bars_by_symbol_override=bars_by_symbol,
    )

    counts = [item["symbol_count"] for item in observations]
    assert observations
    assert min(counts) == len(symbols)
    assert round(sum(counts) / (len(requested_symbols) * len(counts)) * 100.0, 2) == 100.0


def test_seed_factor_descriptions_are_generated_and_persisted(tmp_path):
    client, db_path = create_test_client(tmp_path)

    payload = assert_ok(client.get("/factors"))
    seed = next(item for item in payload["items"] if item["id"] == "s_mom_12m1m_rank")

    assert seed["description"].startswith("逻辑：")
    assert "作用：" in seed["description"]
    assert seed["institutional_note"] == seed["description"]

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT institutional_note FROM factor_definitions WHERE id = ?",
            ("s_mom_12m1m_rank",),
        ).fetchone()

    assert row is not None
    assert str(row["institutional_note"]).startswith("逻辑：")


def test_planned_manual_factor_description_repairs_prior_formula_fallback(tmp_path):
    client, db_path = create_test_client(tmp_path)
    stale_description = (
        "逻辑：开盘/收盘跳空因子根据公式 Mean(Open / Close(t-1),21) 构造可回放截面信号。"
        "作用：用于因子库诊断、排序和模型候选评估。"
    )
    expected_description = "逻辑：衡量过去一个月平均隔夜收益。作用：捕捉非交易时段信息流入，但诊断中保留日内承接风险提示。"
    created = assert_ok(
        client.post(
            "/factors",
            json={
                "name": "Overnight Alpha",
                "market": "US",
                "universe": "SP500",
                "expression": "Mean(Open / Close(t-1),21)",
                "description": stale_description,
                "frequency": "DAILY",
                "direction": "HIGH_IS_BETTER",
                "descriptor": manual_descriptor(category="alpha", metric="overnight", window="21d", operator="raw"),
                "tags": ["manual", "factor_zoo"],
            },
        )
    )

    assert created["id"] == "s_f2_mom_ovn_mean_21d"
    assert created["name"] == "隔夜动量均值 (21d) [Raw]"
    assert created["descriptor"]["canonical_id"] == "s_f2_mom_ovn_mean_21d"
    assert created["tier_level"] == "F2"
    assert created["description"] == expected_description

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE factor_definitions SET institutional_note = ? WHERE id = ?",
            (stale_description, "s_f2_mom_ovn_mean_21d"),
        )

    client.app.state.service._factor_research_service().ensure_default_factors()
    repaired = assert_ok(client.get("/factors/m_alpha_overnight_21d_raw"))

    assert repaired["id"] == "s_f2_mom_ovn_mean_21d"
    assert repaired["tier_level"] == "F2"
    assert repaired["description"] == expected_description
    assert repaired["institutional_note"] == expected_description
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT institutional_note FROM factor_definitions WHERE id = ?",
            ("s_f2_mom_ovn_mean_21d",),
        ).fetchone()

    assert row is not None
    assert row["institutional_note"] == expected_description


def test_overnight_mean_legacy_alpha_factor_is_canonical_f2(tmp_path):
    client, db_path = create_test_client(tmp_path)
    stale_description = (
        "逻辑：开盘/收盘跳空因子根据公式 Mean(Open / Close(t-1),21) 构造可回放截面信号。"
        "作用：用于因子库诊断、排序和模型候选评估。"
    )
    now = "2026-05-19T09:30:00Z"
    with client.app.state.service.storage.connection() as conn:
        conn.execute(
            """
            INSERT INTO factor_definitions (
                id, name, market, universe, source, lifecycle_status, diagnostic_status,
                direction, frequency, expression, tags_json, data_requirements_json,
                institutional_note, created_by, created_at, updated_at
            )
            VALUES (?, ?, 'US', 'SP500', 'MANUAL', 'DRAFT', 'READY_TO_DIAGNOSE',
                'HIGH_IS_BETTER', 'DAILY', ?, ?, ?, ?, 'researcher', ?, ?)
            """,
            (
                "m_alpha_overnight_21d_raw",
                "Overnight Alpha",
                "Mean(Open / Close(t-1),21)",
                dumps(["manual", "factor_zoo"]),
                dumps(["adj_close", "open", "price_history"]),
                stale_description,
                now,
                now,
            ),
        )
        conn.execute(
            """
            INSERT INTO factor_versions (id, factor_id, version, expression, status, metadata_json, created_at)
            VALUES (?, ?, 1, ?, 'ACTIVE', ?, ?)
            """,
            (
                "m_alpha_overnight_21d_raw-v1",
                "m_alpha_overnight_21d_raw",
                "Mean(Open / Close(t-1),21)",
                dumps({"descriptor": manual_descriptor(category="alpha", metric="overnight", window="21d", operator="raw")}),
                now,
            ),
        )

    payload = assert_ok(client.get("/factors?lifecycle=all"))
    by_id = {item["id"]: item for item in payload["items"]}

    assert "m_alpha_overnight_21d_raw" not in by_id
    factor = by_id["s_f2_mom_ovn_mean_21d"]
    assert factor["name"] == "隔夜动量均值 (21d) [Raw]"
    assert factor["expression"] == "Mean(Open / Close(t-1),21)"
    assert factor["descriptor"]["canonical_id"] == "s_f2_mom_ovn_mean_21d"
    assert factor["descriptor"]["category"] == "mom"
    assert factor["descriptor"]["metric"] == "ovn_mean"
    assert factor["tier_level"] == "F2"
    assert factor["tier_projection"]["key"] == "F2"

    legacy_detail = assert_ok(client.get("/factors/m_alpha_overnight_21d_raw"))
    assert legacy_detail["id"] == "s_f2_mom_ovn_mean_21d"

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        old_row = conn.execute(
            "SELECT id FROM factor_definitions WHERE id = ?",
            ("m_alpha_overnight_21d_raw",),
        ).fetchone()
        new_row = conn.execute(
            "SELECT id, source FROM factor_definitions WHERE id = ?",
            ("s_f2_mom_ovn_mean_21d",),
        ).fetchone()

    assert old_row is None
    assert new_row is not None
    assert new_row["source"] == "SYSTEM_SEED"


def test_planned_manual_factor_zoo_formulas_create_with_descriptions_and_diagnose(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client, oscillating=True)
    pit = assert_ok(client.get("/pit-data"))
    specs = [
        (
            "m_mom_riskadj_126x21_raw",
            "Risk-Adjusted Momentum",
            "Return(Close,126) / StdDev(Return(Close,1),21)",
            "HIGH_IS_BETTER",
            manual_descriptor(category="mom", metric="riskadj", window="126x21", operator="raw"),
            "逻辑：通过 21 日波动率平滑半年收益，避免选出暴涨暴跌股票。作用：提升夏普比率，减少净值回撤。",
        ),
        (
            "m_qlty_accruals_ltm_raw",
            "Accruals Quality",
            "-((NetIncome - OperatingCashFlow) / TotalAssets)",
            "HIGH_IS_BETTER",
            manual_descriptor(category="qlty", metric="accruals", window="ltm", operator="raw"),
            "逻辑：衡量净利润与经营现金流的应计差额。作用：作为负向剔除指标，规避业绩造假或盈余质量差的标的。",
        ),
        (
            "m_liq_pvdiv_10d_raw",
            "Price-Volume Divergence",
            "Correlation(Rank(Close), Rank(Volume), 10)",
            "HIGH_IS_BETTER",
            manual_descriptor(category="liq", metric="pvdiv", window="10d", operator="raw"),
            "逻辑：观察过去 10 日价格排名与成交量排名相关性。作用：区分放量上涨的健康趋势与缩量上涨/放量滞涨的反转风险。",
        ),
        (
            "m_val_turnover_skew_60d_raw",
            "Turnover Skewness",
            "Skew(Turnover,60)",
            "HIGH_IS_BETTER",
            manual_descriptor(category="val", metric="turnover_skew", window="60d", operator="raw"),
            "逻辑：计算过去 60 日换手率偏度。作用：识别筹码在少数交易日集中成交带来的短期超额收益线索。",
        ),
        (
            "m_mom_path_eff_20d_raw",
            "Price Efficiency",
            "Abs(Close - Close(t-20)) / Sum(Abs(Close - Close(t-1)),20)",
            "HIGH_IS_BETTER",
            manual_descriptor(category="mom", metric="path_eff", window="20d", operator="raw"),
            "逻辑：用净位移除以路径总长度衡量趋势纯度。作用：配合动量筛掉“电风扇”震荡行情。",
        ),
        (
            "m_vol_asym_updown_60d_raw",
            "Volatility Asymmetry",
            "StdDev(RetUp,60) / StdDev(RetDown,60)",
            "HIGH_IS_BETTER",
            manual_descriptor(category="vol", metric="asym_updown", window="60d", operator="raw"),
            "逻辑：分别计算上涨日和下跌日收益波动。作用：识别下跌波动更剧烈的恐慌盘，可作为回撤惩罚项。",
        ),
        (
            "m_liq_vol_conc_21d_raw",
            "Volume Concentration",
            "Correlation(Volume, Abs(Return(Close,1)),21)",
            "HIGH_IS_BETTER",
            manual_descriptor(category="liq", metric="vol_conc", window="21d", operator="raw"),
            "逻辑：计算成交量与绝对收益率相关性。作用：筛选大幅价格变动伴随真实放量、机构介入度较高的标的。",
        ),
        (
            "m_vol_ret_skew_252d_raw",
            "Return Skewness",
            "Skew(Return(Close,1),252)",
            "LOW_IS_BETTER",
            manual_descriptor(category="vol", metric="ret_skew", window="252d", operator="raw"),
            "逻辑：衡量过去一年收益率分布偏度。作用：过滤高偏度、博彩型、暴涨暴跌标的。",
        ),
        (
            "s_f2_mom_ovn_mean_21d",
            "Overnight Alpha",
            "Mean(Open / Close(t-1),21)",
            "HIGH_IS_BETTER",
            manual_descriptor(category="alpha", metric="overnight", window="21d", operator="raw"),
            "逻辑：衡量过去一个月平均隔夜收益。作用：捕捉非交易时段信息流入，但诊断中保留日内承接风险提示。",
        ),
    ]

    for expected_id, name, expression, direction, descriptor, description in specs:
        preview = assert_ok(client.post("/factors/diagnostics/preview", json={"expression": expression, "lookback_years": 3}))
        assert preview["status"] == "PREVIEW"
        created = assert_ok(
            client.post(
                "/factors",
                json={
                    "name": name,
                    "market": "US",
                    "universe": "SP500",
                    "expression": expression,
                    "description": description,
                    "frequency": "DAILY",
                    "direction": direction,
                    "descriptor": descriptor,
                    "tags": ["manual", "factor_zoo"],
                },
            )
        )
        assert created["id"] == expected_id
        assert created["description"] == description
        assert created["institutional_note"] == description

        diagnostic = assert_ok(
            client.post(
                f"/factors/{expected_id}/diagnostics",
                json={
                    "start_date": pit["diagnostic_windows"]["verified"]["start_date"],
                    "end_date": pit["as_of_date"],
                    "dataset_snapshot_id": pit["dataset_snapshot_id"],
                    "universe_snapshot_id": pit["universe_snapshot_id"],
                    "return_window_days": 21,
                    "group_count": 5,
                    "diagnostic_mode": "VERIFIED",
                },
            )
        )
        assert diagnostic["summary"]["factor_id"] == expected_id
        assert diagnostic["summary"]["rank_ic"] is not None
        assert diagnostic["summary"]["coverage"] > 0


def test_factor_sandbox_diagnostic_runs_with_limited_pit_without_verifying(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    ready_pit = assert_ok(client.get("/pit-data"))
    replace_default_universe_with_current_membership(client, as_of=ready_pit["as_of_date"])
    pit = assert_ok(client.get("/pit-data"))

    factors = assert_ok(client.get("/factors"))
    by_id = {item["id"]: item for item in factors["items"]}
    for factor_id in {
        "s_mom_12m1m_rank",
        "s_val_ep_ltm_raw",
        "s_val_bp_latest_raw",
        "s_vol_252d_rank",
        "s_size_cur_log",
        "s_qlty_roe_ltm_raw",
        "s_qlty_fcfy_ttm_raw",
    }:
        assert by_id[factor_id]["diagnostic_status"] == "SANDBOX_READY"
        assert by_id[factor_id]["strategy_creation_risk"]["can_create"] is True
        assert by_id[factor_id]["strategy_creation_risk"]["blocked_count"] == 0
        assert by_id[factor_id]["blocker_reason_summary"]["status"] in {"clear", "warning"}
        assert any(
            item["code"] == "VERIFIED_PIT_WINDOW_INCOMPLETE"
            for item in by_id[factor_id]["strategy_creation_risk"]["warnings"]
        )
    assert "历史样本池缺失" in by_id["s_mom_12m1m_rank"]["diagnostic_gap_summary"]["rank_ic"]

    formal = client.post(
        "/factors/s_mom_12m1m_rank/diagnostics",
        json={
            "start_date": pit["diagnostic_windows"]["verified"]["start_date"],
            "end_date": pit["as_of_date"],
            "dataset_snapshot_id": pit["dataset_snapshot_id"],
            "universe_snapshot_id": pit["universe_snapshot_id"],
            "return_window_days": 21,
            "group_count": 5,
            "diagnostic_mode": "VERIFIED",
        },
    )
    assert formal.status_code == 400
    assert "Verified PIT" in formal.json()["message"]

    sandbox = assert_ok(
        client.post(
            "/factors/s_mom_12m1m_rank/diagnostics",
            json={
                "start_date": pit["diagnostic_windows"]["sandbox"]["start_date"],
                "end_date": pit["as_of_date"],
                "dataset_snapshot_id": pit["dataset_snapshot_id"],
                "universe_snapshot_id": pit["universe_snapshot_id"],
                "return_window_days": 21,
                "group_count": 5,
                "diagnostic_mode": "SANDBOX",
            },
        )
    )
    assert sandbox["summary"]["diagnostic_mode"] == "SANDBOX"
    assert sandbox["summary"]["admission"]["verified_gate"] == "pending"
    detail = assert_ok(client.get("/factors/momentum_12m_1m"))
    assert detail["id"] == "s_mom_12m1m_rank"
    assert detail["lifecycle_status"] == "DRAFT"
    assert detail["diagnostic_status"] == "SANDBOX_READY"


def test_manual_fundamental_factor_uses_seeded_pit_snapshot(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    pit = assert_ok(client.get("/pit-data"))

    created = assert_ok(
        client.post(
            "/factors",
            json={
                "name": "人工估值",
                "market": "US",
                "universe": "SP500",
                "expression": "LtmEarnings / MarketCap",
                "frequency": "DAILY",
                "direction": "HIGH_IS_BETTER",
                "descriptor": manual_descriptor(category="val", metric="ep", window="ltm", operator="raw"),
                "tags": ["人工"],
            },
        )
    )

    assert created["id"] == "m_val_ep_ltm_raw"
    assert created["diagnostic_status"] == "READY_TO_DIAGNOSE"
    assert "基础数据待补" not in created["tags"]

    result = assert_ok(
        client.post(
            f"/factors/{created['id']}/diagnostics",
            json={
                "start_date": "2023-01-03",
                "end_date": pit["as_of_date"],
                "dataset_snapshot_id": pit["dataset_snapshot_id"],
                "universe_snapshot_id": pit["universe_snapshot_id"],
                "return_window_days": 21,
                "group_count": 5,
            },
        )
    )

    assert result["summary"]["factor_id"] == "m_val_ep_ltm_raw"
    assert result["summary"]["fundamental_snapshot_id"] == "ds-fundamentals"
    assert result["summary"]["descriptor"]["canonical_id"] == "m_val_ep_ltm_raw"


def test_fundamental_pit_loader_filters_on_available_at_not_period_end(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    repository = client.app.state.service.market_data_repository
    repository.replace_fundamental_snapshot(
        {
            "id": "ds-fundamentals",
            "name": "基础面 PIT 可得日测试",
            "status": "READY",
            "as_of": "2021-12-31",
            "freshness_label": "单元测试 available_at",
            "row_count": 2,
            "source": "unit_test",
            "fallback_source": "none",
            "metadata": {
                "covered_symbol_count": 1,
                "total_symbol_count": 1,
                "available_fields": [
                    "ltm_earnings",
                    "book_value_equity",
                    "shares_outstanding",
                    "market_cap",
                    "enterprise_value",
                    "operating_cash_flow_ltm",
                    "capex_ltm",
                ],
            },
        },
        fundamental_points=[
            {
                "symbol": "AAPL",
                "date": "2020-12-31",
                "period_end_date": "2020-12-31",
                "publish_date": "2021-03-01",
                "available_at": "2021-03-01",
                "ltm_earnings": 10.0,
                "book_value_equity": 50.0,
                "shares_outstanding": 1_000_000.0,
                "market_cap": 2_000_000.0,
                "enterprise_value": 2_200_000.0,
                "operating_cash_flow_ltm": 12.0,
                "capex_ltm": 2.0,
            },
            {
                "symbol": "AAPL",
                "date": "2020-12-31",
                "period_end_date": "2020-12-31",
                "publish_date": "2021-06-01",
                "available_at": "2021-06-01",
                "ltm_earnings": 999.0,
                "book_value_equity": 999.0,
                "shares_outstanding": 1_000_000.0,
                "market_cap": 2_000_000.0,
                "enterprise_value": 2_200_000.0,
                "operating_cash_flow_ltm": 999.0,
                "capex_ltm": 2.0,
            },
        ],
        fundamental_coverage=[
            {
                "symbol": "AAPL",
                "start_date": "2021-03-01",
                "end_date": "2021-12-31",
                "observation_count": 2,
                "source": "unit_test",
                "fallback_source": "none",
                "metadata": {"available_at_gate": True},
            }
        ],
    )

    april_rows = repository.load_dataset_fundamental_points(
        "ds-fundamentals",
        ["AAPL"],
        start_date="2020-01-01",
        end_date="2021-04-01",
        as_of_date="2021-04-01",
    )
    july_rows = repository.load_dataset_fundamental_points(
        "ds-fundamentals",
        ["AAPL"],
        start_date="2020-01-01",
        end_date="2021-07-01",
        as_of_date="2021-07-01",
    )

    assert [row["ltm_earnings"] for row in april_rows["AAPL"]] == [10.0]
    assert [row["available_at"] for row in april_rows["AAPL"]] == ["2021-03-01"]
    assert [row["ltm_earnings"] for row in july_rows["AAPL"]] == [10.0, 999.0]
    pit = assert_ok(client.get("/pit-data"))
    fundamental_layer = next(item for item in pit["pit_layer_readiness"] if item["layer_id"] == "l2_fundamental_data")
    assert fundamental_layer["available_at_health"]["missing_available_at_count"] == 0
    linkage = {item["check_id"]: item for item in pit["snapshot_layer_linkage"]}
    assert linkage["fundamental_publish_gate"]["result_status"] == "READY"
    assert all(item["code"] != "MISSING_AVAILABLE_AT" for item in pit["pit_quality_alerts"])


def test_pit_data_blocks_fundamentals_without_publish_date(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    service = client.app.state.service
    repository = service.market_data_repository
    repository.replace_fundamental_snapshot(
        {
            "id": "ds-fundamentals",
            "name": "基础面 PIT 数据",
            "status": "READY",
            "as_of": "2021-03-01",
            "freshness_label": "unit-test",
            "start_date": "2020-12-31",
            "end_date": "2020-12-31",
            "row_count": 1,
            "source": "unit_test",
            "fallback_source": "none",
            "metadata": {
                "covered_symbol_count": 1,
                "total_symbol_count": 1,
                "available_fields": [
                    "ltm_earnings",
                    "revenue",
                    "gross_profit",
                    "net_income",
                    "market_cap",
                    "book_value_equity",
                    "operating_cash_flow",
                    "capex",
                    "enterprise_value",
                    "total_shares",
                    "shares_outstanding",
                    "total_assets",
                    "current_assets",
                    "current_liabilities",
                    "long_term_debt",
                    "total_debt",
                    "cash_and_equivalents",
                ],
            },
        },
        fundamental_points=[
            {
                "symbol": "AAPL",
                "date": "2020-12-31",
                "period_end_date": "2020-12-31",
                "available_at": "2021-03-01",
                "ltm_earnings": 10.0,
                "revenue": 100.0,
                "gross_profit": 40.0,
                "net_income": 8.0,
                "market_cap": 2_000_000.0,
                "book_value_equity": 50.0,
                "operating_cash_flow": 12.0,
                "capex": 2.0,
                "enterprise_value": 2_200_000.0,
                "total_shares": 1_000_000.0,
                "shares_outstanding": 1_000_000.0,
                "total_assets": 120.0,
                "current_assets": 40.0,
                "current_liabilities": 20.0,
                "long_term_debt": 10.0,
                "total_debt": 15.0,
                "cash_and_equivalents": 5.0,
            }
        ],
        fundamental_coverage=[
            {
                "symbol": "AAPL",
                "start_date": "2020-12-31",
                "end_date": "2020-12-31",
                "observation_count": 1,
                "fields": [
                    "ltm_earnings",
                    "revenue",
                    "gross_profit",
                    "net_income",
                    "market_cap",
                    "book_value_equity",
                    "operating_cash_flow",
                    "capex",
                    "enterprise_value",
                    "total_shares",
                    "shares_outstanding",
                    "total_assets",
                    "current_assets",
                    "current_liabilities",
                    "long_term_debt",
                    "total_debt",
                    "cash_and_equivalents",
                ],
            }
        ],
    )
    if hasattr(service, "_invalidate_pit_data_overview_cache"):
        service._invalidate_pit_data_overview_cache()

    pit = assert_ok(client.get("/pit-data"))

    fundamental_layer = next(item for item in pit["pit_layer_readiness"] if item["layer_id"] == "l2_fundamental_data")
    assert fundamental_layer["available_at_health"]["missing_publish_date_count"] == 1
    linkage = {item["check_id"]: item for item in pit["snapshot_layer_linkage"]}
    assert linkage["fundamental_publish_gate"]["result_status"] == "BLOCKED"
    assert any(item["code"] == "MISSING_PUBLISH_DATE" for item in pit["pit_quality_alerts"])


def test_pit_data_promotes_persisted_consensus_to_observation(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    service = client.app.state.service
    repository = service.market_data_repository
    repository.replace_signal_snapshot(
        {
            "id": "ds-analyst-consensus",
            "name": "分析师预期样本",
            "status": "READY",
            "as_of": "2026-04-01",
            "freshness_label": "unit-test",
            "start_date": "2026-03-01",
            "end_date": "2026-04-01",
            "row_count": 1,
            "source": "unit_test",
            "fallback_source": "none",
            "metadata": {"covered_symbol_count": 1, "total_symbol_count": 1},
        },
        signal_points=[
            {
                "entity_key": "AAPL",
                "date": "2026-04-01",
                "publish_date": "2026-04-01",
                "available_at": "2026-04-01",
                "metric_key": "eps_surprise_pct",
                "metric_value": 0.08,
                "source": "unit_test",
                "raw": {"provider": "alpha_vantage"},
            }
        ],
        signal_coverage=[
            {
                "entity_key": "AAPL",
                "start_date": "2026-04-01",
                "end_date": "2026-04-01",
                "observation_count": 1,
                "source": "unit_test",
            }
        ],
    )
    if hasattr(service, "_invalidate_pit_data_overview_cache"):
        service._invalidate_pit_data_overview_cache()

    pit = assert_ok(client.get("/pit-data"))
    l3_layer = next(item for item in pit["pit_layer_readiness"] if item["layer_id"] == "l3_sentiment_data")
    linkage = {item["check_id"]: item for item in pit["snapshot_layer_linkage"]}

    assert l3_layer["status"] == "OBSERVATION"
    assert linkage["consensus_sample_gate"]["result_status"] == "OBSERVATION"


def test_pit_data_marks_partial_fundamental_fields_as_capability(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    seed_partial_fundamental_snapshot(client)

    pit = assert_ok(client.get("/pit-data"))
    l2_layer = next(item for item in pit["pit_layer_readiness"] if item["layer_id"] == "l2_fundamental_data")
    quality_group = next(item for item in pit["factor_diagnostic_readiness"] if item["group_id"] == "quality_valuation")
    field_module = next(item for item in l2_layer["submodules"] if item["id"] == "fundamental_fields")

    assert pit["fundamental_status"] == "PARTIAL_READY"
    assert l2_layer["status"] == "PARTIAL_READY"
    assert field_module["usable"] is True
    assert field_module["metrics"]["available_field_count"] == 3
    assert quality_group["status"] == "PARTIAL_READY"
    assert "fundamental_balance_check" in quality_group["blocked_checks"]
    assert quality_group["upstream_capabilities"][0]["allowed_actions"] == [
        "research_preview",
        "run_sandbox_diagnostics",
    ]


def test_pit_data_exposes_short_volume_without_disabling_sentiment(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    seed_ready_signal_snapshot(client, "ds-short-volume", point_count=2)

    pit = assert_ok(client.get("/pit-data"))
    l3_layer = next(item for item in pit["pit_layer_readiness"] if item["layer_id"] == "l3_sentiment_data")
    sentiment_group = next(item for item in pit["factor_diagnostic_readiness"] if item["group_id"] == "sentiment_micro")
    short_module = next(item for item in l3_layer["submodules"] if item["id"] == "short_volume")
    linkage = {item["check_id"]: item for item in pit["snapshot_layer_linkage"]}

    assert l3_layer["status"] == "PARTIAL_READY"
    assert short_module["status"] == "READY"
    assert short_module["usable"] is True
    assert sentiment_group["status"] == "PARTIAL_READY"
    assert sentiment_group["status"] != "DISABLED"
    assert "short_volume_gate" in sentiment_group["satisfied_checks"]
    assert linkage["short_volume_gate"]["result_status"] == "READY"
    assert linkage["short_volume_gate"]["hard_blocking"] is False


def test_pit_data_exposes_macro_features_when_price_replay_is_blocked(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    mark_price_snapshot_incomplete(client, missing_symbols=["AABA"])
    seed_ready_signal_snapshot(client, "ds-macro-rates", point_count=10, total_symbol_count=10)
    seed_ready_signal_snapshot(client, "ds-option-skew", point_count=2)

    pit = assert_ok(client.get("/pit-data"))
    l4_layer = next(item for item in pit["pit_layer_readiness"] if item["layer_id"] == "l4_macro_derivatives")
    macro_group = next(item for item in pit["factor_diagnostic_readiness"] if item["group_id"] == "macro_derivatives")
    macro_module = next(item for item in l4_layer["submodules"] if item["id"] == "macro_rates")
    iv_module = next(item for item in l4_layer["submodules"] if item["id"] == "option_skew")

    assert l4_layer["status"] == "PARTIAL_READY"
    assert macro_module["status"] == "READY"
    assert iv_module["status"] == "READY"
    assert macro_group["status"] == "PARTIAL_READY"
    assert "price_replay_gate" in macro_group["blocked_checks"]
    assert macro_group["upstream_capabilities"][0]["mode"] == "PARTIAL_READY"


def test_factor_diagnostics_reject_current_universe_snapshot_binding(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    pit = assert_ok(client.get("/pit-data"))
    seed_current_only_universe(client, universe_snapshot_id="un-current", as_of=pit["as_of_date"])

    created = assert_ok(
        client.post(
            "/factors",
            json={
                "name": "5日动量",
                "market": "US",
                "universe": "SP500",
                "expression": "Rank(Delta(Close, 5))",
                "frequency": "DAILY",
                "direction": "HIGH_IS_BETTER",
                "descriptor": manual_descriptor(),
                "tags": ["人工"],
            },
        )
    )

    missing_binding = client.post(
        f"/factors/{created['id']}/diagnostics",
        json={
            "start_date": "2023-01-03",
            "end_date": pit["as_of_date"],
            "return_window_days": 21,
            "group_count": 5,
        },
    )
    assert missing_binding.status_code == 422

    current_universe = client.post(
        f"/factors/{created['id']}/diagnostics",
        json={
            "start_date": "2023-01-03",
            "end_date": pit["as_of_date"],
            "dataset_snapshot_id": pit["dataset_snapshot_id"],
            "universe_snapshot_id": "un-current",
            "return_window_days": 21,
            "group_count": 5,
        },
    )

    assert current_universe.status_code == 400
    assert "不能使用当前 Universe 降级" in current_universe.json()["message"]


def test_factor_preview_accepts_nested_operator_formula(tmp_path):
    client, _db_path = create_test_client(tmp_path)

    preview = assert_ok(
        client.post(
            "/factors/diagnostics/preview",
            json={
                "expression": "Ts_Rank(Correlation(Close, Volume, 10), 20)",
                "lookback_years": 3,
            },
        )
    )

    assert preview["status"] == "PREVIEW"
    assert preview["mode"] == "SINGLE"
    assert preview["lookback_years"] == 3


def test_factor_preview_accepts_residual_factor_reference_formula(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    pit = assert_ok(client.get("/pit-data"))
    expression = 'ZScore(Residual(s_mom_6m_rank, by="s_vol_252d_raw"))'

    preview = assert_ok(
        client.post(
            "/factors/diagnostics/preview",
            json={
                "expression": expression,
                "lookback_years": 3,
            },
        )
    )

    assert preview["status"] == "PREVIEW"
    assert preview["mode"] == "SINGLE"
    assert preview["expression"] == expression

    created = assert_ok(
        client.post(
            "/factors",
            json={
                "name": "6m residual momentum",
                "market": "US",
                "universe": "SP500",
                "expression": expression,
                "frequency": "DAILY",
                "direction": "HIGH_IS_BETTER",
                "descriptor": manual_descriptor(metric="long", window="126d", operator="z"),
                "tags": ["manual"],
            },
        )
    )

    assert created["id"] == "m_mom_long_126d_z"
    assert created["expression"] == expression
    assert all(
        item.get("code") != "UNSAFE_EXPRESSION"
        for item in created["strategy_creation_risk"]["hard_blockers"]
    )
    assert created["strategy_creation_risk"]["can_create"] is True

    diagnostic = assert_ok(
        client.post(
            f"/factors/{created['id']}/diagnostics",
            json={
                "start_date": pit["diagnostic_windows"]["verified"]["start_date"],
                "end_date": pit["as_of_date"],
                "dataset_snapshot_id": pit["dataset_snapshot_id"],
                "universe_snapshot_id": pit["universe_snapshot_id"],
                "return_window_days": 21,
                "group_count": 5,
                "diagnostic_mode": "VERIFIED",
            },
        )
    )

    assert diagnostic["summary"]["factor_id"] == "m_mom_long_126d_z"
    assert diagnostic["summary"]["rank_ic"] is not None
    assert diagnostic["summary"]["ic_series"]


def test_factor_reference_ratio_formulas_produce_diagnostics(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    pit = assert_ok(client.get("/pit-data"))
    factor_specs = [
        (
            "风险调整后动量",
            "Rank(s_mom_6m_rank / s_vol_126d_raw)",
            "longra",
            "m_mom_longra_126d_rank",
        ),
        (
            "下行风险调整后6m动量",
            "Rank(s_mom_6m_rank / s_vol_downside_126d_raw)",
            "longdra",
            "m_mom_longdra_126d_rank",
        ),
    ]
    created_ids = []
    for name, expression, metric, expected_id in factor_specs:
        preview = assert_ok(
            client.post(
                "/factors/diagnostics/preview",
                json={"expression": expression, "lookback_years": 3},
            )
        )
        assert preview["status"] == "PREVIEW"
        created = assert_ok(
            client.post(
                "/factors",
                json={
                    "name": name,
                    "market": "US",
                    "universe": "SP500",
                    "expression": expression,
                    "frequency": "DAILY",
                    "direction": "HIGH_IS_BETTER",
                    "descriptor": manual_descriptor(metric=metric, window="126d", operator="rank"),
                    "tags": ["人工"],
                },
            )
        )
        assert created["id"] == expected_id
        created_ids.append(expected_id)

    batch_preview = assert_ok(
        client.post(
            "/factors/diagnostics/preview",
            json={
                "batch": True,
                "factor_ids": created_ids,
                "diagnostic_mode": "SANDBOX",
                "include": ["ic", "ir", "groups", "turnover"],
            },
        )
    )
    preview_by_id = {item["factor_id"]: item["latest_diagnostic_summary"] for item in batch_preview["items"]}
    for factor_id in created_ids:
        summary = preview_by_id[factor_id]
        assert summary["status"] == "PREVIEW"
        assert summary["data_lineage"]["kind"] == "FACTOR_EXPRESSION_PREVIEW"
        assert isinstance(summary["rank_ic"], float)
        assert summary["coverage"] > 0
        assert summary["ic_series"]
        assert summary["group_return_series"]
        assert summary["monotonicity"]["window_periods"] == 3
        assert summary["monotonicity"]["required_consecutive_periods"] == 3

    for factor_id in created_ids:
        diagnostic = assert_ok(
            client.post(
                f"/factors/{factor_id}/diagnostics",
                json={
                    "start_date": pit["diagnostic_windows"]["verified"]["start_date"],
                    "end_date": pit["as_of_date"],
                    "dataset_snapshot_id": pit["dataset_snapshot_id"],
                    "universe_snapshot_id": pit["universe_snapshot_id"],
                    "return_window_days": 21,
                    "group_count": 5,
                    "diagnostic_mode": "VERIFIED",
                },
            )
        )
        assert diagnostic["summary"]["factor_id"] == factor_id
        assert diagnostic["summary"]["rank_ic"] is not None
        assert diagnostic["summary"]["ic_series"]
        assert diagnostic["summary"]["group_return_series"]
        assert diagnostic["summary"]["monotonicity"]["window_periods"] == 3


def test_factor_preview_accepts_planned_composition_recipes(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    expressions = [
        "s_mom_6m_rank * s_qlty_roe_ltm_raw",
        "s_mom_6m_rank / s_vol_252d_rank",
        VALUE_VOL_WNZT_F3_EXPRESSION,
        "s_mom_6m_rank - s_vol_downside_252d_rank",
        'ZScore(Residual(s_liq_amihud_20d_rank, by="s_size_cur_log"))',
        "TsRank(Return(Close, 5), 252)",
    ]

    for expression in expressions:
        assert validate_factor_expression(expression) == []
        preview = assert_ok(
            client.post(
                "/factors/diagnostics/preview",
                json={"expression": expression, "lookback_years": 3},
            )
        )
        assert preview["status"] == "PREVIEW"
        assert preview["expression"] == expression
        summary = preview.get("latest_diagnostic_summary") or preview.get("summary") or preview
        assert (summary.get("rank_ic") if isinstance(summary, dict) else None) is not None or preview["rank_ic_preview"] is not None


def test_blocked_seed_factor_cannot_run_diagnostic_without_fundamentals(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)
    clear_fundamental_snapshot(client)
    pit = assert_ok(client.get("/pit-data"))
    assert pit["fundamental_status"] == "BLOCKED"

    factors = assert_ok(client.get("/factors"))
    by_id = {item["id"]: item for item in factors["items"]}
    assert by_id["s_val_ep_ltm_raw"]["diagnostic_status"] == "BLOCKED_PIT"
    assert by_id["s_val_ep_ltm_raw"]["strategy_creation_risk"]["can_create"] is False
    assert by_id["s_val_ep_ltm_raw"]["strategy_creation_risk"]["blocked_count"] >= 1
    assert by_id["s_val_ep_ltm_raw"]["blocker_reason_summary"]["status"] == "blocked"
    assert "基础面 PIT 缺口" in by_id["s_val_ep_ltm_raw"]["diagnostic_gap_summary"]["rank_ic"]

    response = client.post(
        "/factors/value_ep_ltm/diagnostics",
        json={
            "start_date": "2023-01-03",
            "end_date": pit["as_of_date"],
            "dataset_snapshot_id": pit["dataset_snapshot_id"],
            "universe_snapshot_id": pit["universe_snapshot_id"],
            "return_window_days": 21,
            "group_count": 5,
        },
    )

    assert response.status_code == 400
    assert "基础面 PIT" in response.json()["message"]

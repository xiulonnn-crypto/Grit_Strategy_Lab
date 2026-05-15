from __future__ import annotations

import sqlite3

from datetime import date, timedelta

from grit_backtest_platform import _real_service_rebuilt as real_service_module
from grit_backtest_platform.factor_research import validate_factor_expression
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
        "s_beta_market_252d_raw",
        "s_val_cfp_ltm_raw",
        "s_qlty_leverage_cur_raw",
        "s_inv_assetgrowth_1y_rank",
        "s_inv_capex_ltm_raw",
        "s_mom_6m_rank",
        "s_liq_amihud_20d_rank",
        "s_alpha_ffblend_cur_rank",
    }
    legacy_ids = {
        "momentum_12m_1m",
        "lowvol_realized_252d",
        "value_ep_ltm",
        "value_bp_latest",
        "quality_roe_ltm",
        "quality_fcf_yield",
        "size_log_market_cap",
    }
    assert canonical_ids.issubset(ids)
    assert expanded_seed_ids.issubset(ids)
    assert ids.isdisjoint(legacy_ids)
    assert payload["summary"]["blocked_data_count"] == 0

    by_id = {item["id"]: item for item in payload["items"]}
    assert by_id["s_beta_market_252d_raw"]["name"] == "市场贝塔代理（252日）"
    assert by_id["s_val_cfp_ltm_raw"]["name"] == "现金流市值比（LTM）"
    assert by_id["s_alpha_ffblend_cur_rank"]["name"] == "Fama-French 风格合成 Alpha"
    assert payload["summary"]["f1_count"] >= 1
    assert payload["summary"]["f2_count"] >= 1
    assert payload["summary"]["f3_count"] >= 1
    assert payload["summary"]["lifecycle_sandbox_count"] >= 0
    assert payload["summary"]["to_be_verified_count"] >= 0
    assert by_id["s_size_mcap_cur_raw"]["tier_level"] == "F1"
    assert by_id["s_size_mcap_cur_raw"]["tier_label"] == "F1 原始"
    assert by_id["s_val_ep_ltm_raw"]["tier_level"] == "F2"
    assert by_id["s_mom_12m1m_rank"]["tier_level"] == "F2"
    assert by_id["s_alpha_ffblend_cur_rank"]["tier_level"] == "F3"
    assert by_id["s_alpha_ffblend_cur_rank"]["tier_label"] == "F3 组合"
    assert by_id["s_mom_12m1m_rank"]["lifecycle"] == "online"
    assert by_id["s_mom_12m1m_rank"]["lifecycle_label"] == "线上"
    assert by_id["s_mom_12m1m_rank"]["factor_level"] in {"B", "C"}
    assert by_id["s_mom_12m1m_rank"]["factor_level_label"] in {"B 观察", "C 待校准"}
    assert "T" in by_id["s_mom_12m1m_rank"]["op_status"]["completed"]
    assert {light["code"] for light in by_id["s_mom_12m1m_rank"]["op_status"]["lights"]} == {"W", "N", "Z", "T"}
    assert by_id["s_alpha_ffblend_cur_rank"]["lineage_summary"]["parent_count"] >= 4
    assert by_id["s_alpha_ffblend_cur_rank"]["lineage_summary"]["has_lineage"] is True
    assert set(by_id["s_alpha_ffblend_cur_rank"]["lineage_summary"]["parent_ids"]) >= {
        "s_mom_12m1m_rank",
        "s_val_ep_ltm_raw",
        "s_qlty_roe_ltm_raw",
        "s_size_cur_log",
    }
    assert set(by_id["s_size_mcap_cur_raw"]["lineage_summary"]["relation_types"]) >= {"DIRECT_SOURCE"}
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
    assert legacy_detail["name"] == "滚动市盈率倒数 (LTM)"
    assert assert_ok(client.get("/factors/value_bp_latest"))["id"] == "s_val_bp_latest_raw"
    assert assert_ok(client.get("/factors/quality_roe_ltm"))["id"] == "s_qlty_roe_ltm_raw"
    detail = assert_ok(client.get("/factors/s_alpha_ffblend_cur_rank"))
    assert detail["lineage_tree"]["node"]["id"] == "s_alpha_ffblend_cur_rank"
    assert detail["lineage_tree"]["parent_count"] >= 4
    assert {parent["id"] for parent in detail["lineage_tree"]["parents"]} >= {
        "s_mom_12m1m_rank",
        "s_val_ep_ltm_raw",
        "s_qlty_roe_ltm_raw",
        "s_size_cur_log",
    }


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
    assert by_id["s_alpha_ffblend_cur_rank"]["factor_family"] == "其他"


def test_factor_library_migrates_system_seed_expression_versions(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    assert_ok(client.get("/factors"))
    storage = client.app.state.service.storage
    legacy_expressions = {
        "s_alpha_ffblend_cur_rank": "Rank(Return(Close, 252))",
        "s_beta_market_252d_raw": "Return(Close, 252)",
        "s_beta_resid_252d_z": "ZScore(Return(Close, 252))",
        "s_inv_assetgrowth_1y_rank": "Return(Close, 252)",
    }
    expected_expressions = {
        "s_alpha_ffblend_cur_rank": "FFBlend(Momentum252, ValueEP, QualityROE, Size)",
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
                    "s_alpha_ffblend_cur_rank",
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
        "s_alpha_ffblend_cur_rank",
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
    assert round(style_rank_ics["s_alpha_ffblend_cur_rank"], 4) != round(style_rank_ics["s_beta_market_252d_raw"], 4)


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


def test_factor_detail_hot_path_does_not_call_heavy_pit_overview(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)

    service = client.app.state.service
    service._factor_research_service_instance = None

    def fail_if_called():
        raise AssertionError("/factors/{id} must not wait for the heavy PIT overview builder")

    service.get_pit_data_overview = fail_if_called

    payload = assert_ok(client.get("/factors/s_alpha_ffblend_cur_rank"))

    assert payload["id"] == "s_alpha_ffblend_cur_rank"
    assert payload["name"] == "Fama-French 风格合成 Alpha"
    assert payload["diagnostic_status"] in {"READY_TO_DIAGNOSE", "SANDBOX_READY", "COMPLETED"}


def test_factor_library_does_not_fake_ic_sparkline_without_diagnostic(tmp_path):
    client, _db_path = create_test_client(tmp_path)
    seed_ready_pit_data(client)

    payload = assert_ok(client.get("/factors"))
    factor = next(item for item in payload["items"] if item["id"] == "s_beta_market_252d_raw")

    assert factor["latest_diagnostic_summary"] is None
    assert factor["ic_sparkline"] == []
    assert factor["diagnostic_gap_summary"]["rank_ic"].startswith("Rank IC:")


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
    deprecate_action = next(
        item for item in actions if item["kind"] == "DEPRECATE" and deprecate_id in item["factor_ids"]
    )
    prune_action = next(
        item for item in actions if item["kind"] == "PRUNE" and prune_id in item["factor_ids"]
    )
    assert deprecate_action["command"] == "DEPRECATE"
    assert deprecate_action["offline_detail"]["grade"] == "D"
    assert deprecate_action["offline_detail"]["noise_like"] is True
    assert prune_action["command"] == "PRUNE"
    assert prune_action["keep_factor_id"] == keep_id
    assert prune_action["offline_detail"]["correlation"] == 0.94


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
    assert optimized["id"] == "m_vol_downsiderev_252d_rank"
    assert optimized["name"] == "反向下行波动率代理（252日）"
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
    assert executed["created_factor_id"] == "m_vol_downsiderev_252d_rank"
    created = assert_ok(client.get("/factors/m_vol_downsiderev_252d_rank"))
    assert created["name"] == "反向下行波动率代理（252日）"
    assert created["source"] == "MANUAL"
    assert created["lifecycle_status"] == "VERIFIED"
    assert created["direction"] == "HIGH_IS_BETTER"
    assert created["latest_diagnostic_summary"]["status"] == "COMPLETED"
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


def test_factor_governance_overview_deprecates_preview_grade_d_seed_factors(tmp_path, monkeypatch):
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
    deprecate_actions = {
        action["factor_ids"][0]: action
        for action in overview["actions"]
        if action["kind"] == "DEPRECATE" and action["factor_ids"][0] in target_ids
    }
    assert set(deprecate_actions) == target_ids
    for factor_id, action in deprecate_actions.items():
        preview_summary = preview_by_id[factor_id]["latest_diagnostic_summary"]
        assert action["offline_detail"]["preview_only"] is True
        assert action["offline_detail"]["grade"] == "D"
        assert action["offline_detail"]["rank_ic"] == preview_summary["rank_ic"]
        assert action["offline_detail"]["ir"] == preview_summary["ir"]

    action = deprecate_actions["s_mom_shortrev_1m_rank"]
    executed = assert_ok(
        client.post(
            f"/factor-governance/actions/{action['id']}/execute",
            json={
                "confirm": True,
                "command": "DEPRECATE",
                "factor_ids": ["s_mom_shortrev_1m_rank"],
                "reason": "强制下线：只读预览 Grade D 噪声信号。",
                "detail": action.get("offline_detail", {}),
            },
        )
    )
    assert executed["items"][0]["lifecycle_status"] == "DEPRECATED"
    offline_by_id = {
        item["id"]: item
        for item in assert_ok(client.get("/factors?lifecycle=offline"))["items"]
    }
    assert offline_by_id["s_mom_shortrev_1m_rank"]["offline_detail"]["evidence"]["preview_only"] is True


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
    seed_factor_diagnostic_summary(
        client,
        keep_id,
        governance_ready_summary(rank_ic=0.0955, ir=2.7573, coverage=98.99),
        run_id=f"fdiag_{keep_id}_mvp",
    )
    seed_factor_diagnostic_summary(
        client,
        prune_id,
        governance_ready_summary(rank_ic=0.075, ir=1.0997, coverage=98.34),
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
    assert action["offline_detail"]["comparison"]["mvp"]["factor_id"] == keep_id


def test_factor_governance_prune_uses_standard_style_categories(tmp_path, monkeypatch):
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
    prune_id = "s_beta_resid_252d_z"
    seed_factor_diagnostic_summary(
        client,
        keep_id,
        governance_ready_summary(rank_ic=0.075, ir=2.2, coverage=99.0),
        run_id=f"fdiag_{keep_id}_style_mvp",
    )
    seed_factor_diagnostic_summary(
        client,
        prune_id,
        governance_ready_summary(rank_ic=0.024, ir=0.42, coverage=91.0),
        run_id=f"fdiag_{prune_id}_style_prune",
    )

    original_pair_correlation = factor_service._factor_pair_correlation

    def style_pair_correlation(left, right):
        pair = {str(left.get("id") or ""), str(right.get("id") or "")}
        if pair == {keep_id, prune_id}:
            return 0.94
        return original_pair_correlation(left, right)

    monkeypatch.setattr(factor_service, "_factor_pair_correlation", style_pair_correlation)

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
        governance_ready_summary(rank_ic=0.002, ir=0.12, coverage=94.0, inverted=True, low_efficiency=True),
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
            },
        )
    )
    assert executed["command"] == "DEPRECATE"
    assert executed["affected_factor_ids"] == [factor_id]
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
    seed_factor_diagnostic_summary(
        client,
        prune_id,
        governance_ready_summary(rank_ic=0.018, ir=0.31, coverage=82.0),
        run_id=f"fdiag_{prune_id}_weak",
    )
    seed_factor_diagnostic_summary(
        client,
        keep_id,
        governance_ready_summary(rank_ic=0.095, ir=5.12, coverage=99.0),
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
            "Correlation(Volume, Abs(Return(Close,1)),21)",
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
    seed_factor_diagnostic_summary(
        client,
        "m_liq_pvdiv_10d_raw",
        governance_ready_summary(rank_ic=0.021, ir=0.8, coverage=98.99),
        run_id="fdiag_m_liq_pvdiv_10d_raw_weak",
    )
    seed_factor_diagnostic_summary(
        client,
        "m_liq_vol_conc_21d_raw",
        governance_ready_summary(rank_ic=0.0253, ir=1.0171, coverage=98.99),
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

    assert created["id"] == "m_alpha_overnight_21d_raw"
    assert created["description"] == expected_description

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            "UPDATE factor_definitions SET institutional_note = ? WHERE id = ?",
            (stale_description, "m_alpha_overnight_21d_raw"),
        )

    client.app.state.service._factor_research_service().ensure_default_factors()
    repaired = assert_ok(client.get("/factors/m_alpha_overnight_21d_raw"))

    assert repaired["description"] == expected_description
    assert repaired["institutional_note"] == expected_description
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute(
            "SELECT institutional_note FROM factor_definitions WHERE id = ?",
            ("m_alpha_overnight_21d_raw",),
        ).fetchone()

    assert row is not None
    assert row["institutional_note"] == expected_description


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
            "m_alpha_overnight_21d_raw",
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
        'ZScore(Residual(s_val_cfp_ltm_raw, by="s_size_cur_log"))',
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

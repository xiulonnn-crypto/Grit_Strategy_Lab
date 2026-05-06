from __future__ import annotations

from datetime import date, timedelta

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


def seed_ready_pit_data(client, *, start: date = date(2014, 1, 2), day_count: int = 3200) -> None:
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


def replace_default_universe_with_current_membership(client, *, as_of: str) -> None:
    repository = client.app.state.service.market_data_repository
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


def mark_price_snapshot_incomplete(
    client,
    *,
    missing_symbols: list[str],
    provider_summary: dict | None = None,
) -> None:
    repository = client.app.state.service.market_data_repository
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
    trust_summary = ready_payload["data_trust_summary"]
    assert trust_summary["summary_label"] == "数据可信层"
    assert {item["id"] for item in trust_summary["layers"]} >= {
        "price_primary_chain",
        "membership_history",
        "delisted_identity",
        "corporate_actions_zero_event",
    }


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
    monkeypatch.delenv("POLYGON_API_KEY", raising=False)
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


def test_factor_library_projects_reference_metrics_for_new_factors(tmp_path):
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
    assert created_summary["status"] == "REFERENCE_ONLY"
    assert created_summary["source_factor_id"] in reference_factor_ids
    assert created_summary["data_lineage"]["kind"] == "REFERENCE_DEFAULT_FACTOR"

    factors = assert_ok(client.get("/factors"))
    by_id = {item["id"]: item for item in factors["items"]}
    manual_summary = by_id["m_mom_short_5d_rank"]["latest_diagnostic_summary"]
    expanded_summary = by_id["s_mom_6m_rank"]["latest_diagnostic_summary"]

    assert manual_summary["status"] == "REFERENCE_ONLY"
    assert manual_summary["source_factor_id"] in reference_factor_ids
    assert manual_summary["data_lineage"]["kind"] == "REFERENCE_DEFAULT_FACTOR"
    assert isinstance(manual_summary["rank_ic"], float)
    assert expanded_summary["status"] == "REFERENCE_ONLY"
    assert expanded_summary["source_factor_id"] == "s_mom_12m1m_rank"
    assert by_id["m_mom_short_5d_rank"]["last_diagnostic_run_id"] is None


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
    assert after_runs == before_runs


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

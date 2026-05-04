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


def mark_price_snapshot_incomplete(client, *, missing_symbols: list[str]) -> None:
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
            WHERE id = 'ds-price'
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
        "s_vol_252d_rank",
        "s_size_cur_log",
        "s_qlty_fcfy_ttm_raw",
    }
    legacy_ids = {
        "momentum_12m_1m",
        "lowvol_realized_252d",
        "value_ep_ltm",
        "quality_fcf_yield",
        "size_log_market_cap",
    }
    assert canonical_ids.issubset(ids)
    assert ids.isdisjoint(legacy_ids)
    assert payload["summary"]["blocked_data_count"] == 0

    by_id = {item["id"]: item for item in payload["items"]}
    for factor_id in canonical_ids:
        assert by_id[factor_id]["diagnostic_status"] == "READY_TO_DIAGNOSE"
        assert by_id[factor_id]["descriptor"]["canonical_id"] == factor_id
        assert by_id[factor_id]["created_at"]
        assert by_id[factor_id]["updated_at"]
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
        "s_vol_252d_rank",
        "s_size_cur_log",
        "s_qlty_fcfy_ttm_raw",
    }:
        assert by_id[factor_id]["diagnostic_status"] == "SANDBOX_READY"
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

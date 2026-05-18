from __future__ import annotations

from tests.api_test_support import (
    assert_ok,
    assert_snapshot_overview_contract,
    assert_workspace_overview_contract,
    create_grid_strategy,
    create_momentum_strategy,
    create_optimization_candidate,
    create_optimization_job,
    create_test_client,
    draft_strategy_session,
    materialize_session,
    momentum_confirmation_payload,
    preview_backtest,
    refresh_snapshots,
    submit_backtest,
    wait_for_optimization_job,
)
from datetime import date, datetime, timedelta, timezone
from fastapi.testclient import TestClient
import os
from pathlib import Path
import json
import threading
import time
from typing import Any
from types import SimpleNamespace

from grit_backtest_platform import api as api_module
from grit_backtest_platform.api import create_app
from grit_backtest_platform._real_service_rebuilt import RealBacktestPlatformService
from grit_backtest_platform._storage_restored import SQLiteStorage
from grit_backtest_platform import _real_service_rebuilt as real_service_module
from grit_backtest_platform.market_data_repository import CoverageSummary, MarketDataRepository
from grit_backtest_platform.snapshot_provider_projection import build_data_trust_summary, build_provider_registry
from grit_backtest_platform.universe_history import (
    ANCHOR_SCHEDULE,
    NASDAQ100_UNIVERSE_KEY,
    NASDAQ100_UNIVERSE_NAME,
    NASDAQ100_UNIVERSE_SNAPSHOT_ID,
    NASDAQ100_SOURCE_PAGE_TITLE,
    SP500_UNIVERSE_KEY,
    SP500_UNIVERSE_NAME,
    SP500_UNIVERSE_SNAPSHOT_ID,
    SP500_SOURCE_PAGE_TITLE,
    UniverseMembershipSnapshot,
)


def _manual_tmp_db_path(name: str) -> Path:
    root = Path(".tmp") / "backend-api-unit-dbs"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{name}-{os.getpid()}-{time.time_ns()}.db"


def test_workspace_overview_contract_is_exact_on_fresh_database(tmp_path):
    client, _ = create_test_client(tmp_path)

    overview = assert_ok(client.get("/workspace/overview"))

    assert_workspace_overview_contract(overview)
    assert overview["strategy_count"] == 0
    assert overview["latest_strategy_id"] is None
    assert overview["latest_backtest_run_id"] is None
    assert overview["latest_optimization_job_id"] is None


def test_market_data_repository_uses_wal_and_busy_timeout(tmp_path):
    repository = MarketDataRepository(tmp_path / "market-data-locking.db")

    with repository.connect() as conn:
        busy_timeout = conn.execute("PRAGMA busy_timeout").fetchone()["timeout"]
        journal_mode = str(conn.execute("PRAGMA journal_mode").fetchone()["journal_mode"]).lower()
        synchronous = int(conn.execute("PRAGMA synchronous").fetchone()["synchronous"])

    assert busy_timeout >= 30000
    assert journal_mode == "wal"
    assert synchronous == 1


def test_platform_storage_uses_wal_and_busy_timeout(tmp_path):
    storage = SQLiteStorage(tmp_path / "platform-locking.db")

    with storage.connection() as conn:
        busy_timeout = conn.execute("PRAGMA busy_timeout").fetchone()["timeout"]
        journal_mode = str(conn.execute("PRAGMA journal_mode").fetchone()["journal_mode"]).lower()
        synchronous = int(conn.execute("PRAGMA synchronous").fetchone()["synchronous"])

    assert busy_timeout >= 30000
    assert journal_mode == "wal"
    assert synchronous == 1


def test_service_initialization_defers_read_model_cache_prewarm(tmp_path, monkeypatch):
    prewarm_calls: list[str] = []

    def record_prewarm(_service):
        prewarm_calls.append("prewarm")

    monkeypatch.setattr(RealBacktestPlatformService, "_prewarm_read_model_caches", record_prewarm)

    RealBacktestPlatformService(tmp_path / "startup-prewarm.db", market_data_provider=None)

    assert prewarm_calls == []


def test_workspace_overview_can_include_cleanup_audit_without_changing_default_contract(tmp_path):
    client, _ = create_test_client(tmp_path)

    overview = assert_ok(client.get("/workspace/overview?include_cleanup_audit=1"))

    assert_workspace_overview_contract(overview, include_cleanup_audit=True)
    assert overview["last_cleanup_count"] == 0


def test_backtest_runs_list_and_detail_include_strategy_name(tmp_path):
    client, _ = create_test_client(tmp_path)
    strategy = create_momentum_strategy(client, idempotency_key="runs-list-strategy-name")["strategy"]
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")

    _insert_backtest_run(
        client,
        run_id="run_list_strategy_name",
        strategy_id=strategy["id"],
        created_at=created_at,
        is_permanent=0,
        artifact_paths=[],
    )

    runs = assert_ok(client.get("/backtest-runs?limit=1"))
    detail = assert_ok(client.get("/backtest-runs/run_list_strategy_name/detail?view=initial"))

    assert runs[0]["id"] == "run_list_strategy_name"
    assert runs[0]["strategy_id"] == strategy["id"]
    assert runs[0]["strategy_name"] == strategy["name"]
    assert detail["id"] == "run_list_strategy_name"
    assert detail["strategy_id"] == strategy["id"]
    assert detail["strategy_name"] == strategy["name"]


def test_strategies_list_includes_latest_completed_run_summary_for_workspace_cards(tmp_path):
    client, _ = create_test_client(tmp_path)
    strategy = create_momentum_strategy(client, idempotency_key="workspace-latest-run-summary")["strategy"]
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    run_id = "run_workspace_summary"

    _insert_backtest_run(
        client,
        run_id=run_id,
        strategy_id=strategy["id"],
        created_at=created_at,
        is_permanent=0,
        artifact_paths=[],
    )

    client.app.state.service.storage.execute(
        """
        UPDATE backtest_runs
        SET request_json = ?,
            preview_json = ?,
            metrics_json = ?,
            warnings_json = ?,
            chart_series_json = ?
        WHERE id = ?
        """,
        (
            json.dumps(
                {
                    "execution_policy": "T_CLOSE_TO_T1_OPEN",
                    "dataset_snapshot_id": "ds-price",
                    "universe_snapshot_id": "un-sp500",
                    "parameter_version_id": strategy["current_parameter_version_id"],
                }
            ),
            json.dumps({"parameter_version_id": strategy["current_parameter_version_id"]}),
            json.dumps(
                {
                    "total_return": 0.184,
                    "annualized_return": 0.112,
                    "sharpe": 1.18,
                    "max_drawdown": -0.064,
                    "oos_total_return": 0.054,
                    "oos_annualized_return": 0.041,
                    "oos_sharpe": 0.67,
                    "oos_max_drawdown": -0.031,
                }
            ),
            json.dumps(["warning-a", "warning-b"]),
            json.dumps(
                [
                    {"trade_date": "2026-03-01", "equity": 100.0, "is_oos": False},
                    {"trade_date": "2026-03-02", "equity": 104.0, "is_oos": False},
                    {"trade_date": "2026-03-03", "equity": 108.0, "is_oos": True},
                ]
            ),
            run_id,
        ),
    )

    strategies = assert_ok(client.get("/strategies"))
    strategy_item = next(item for item in strategies if item["id"] == strategy["id"])
    summary = strategy_item["latest_completed_run_summary"]

    assert summary["run_id"] == run_id
    assert summary["parameter_version"] == strategy["current_parameter_version"]
    assert summary["execution_policy"] == "T_CLOSE_TO_T1_OPEN"
    assert summary["dataset_snapshot_id"] == "ds-price"
    assert summary["universe_snapshot_id"] == "un-sp500"
    assert summary["warning_count"] == 2
    assert summary["sparkline_points"][-1] == {
        "date": "2026-03-03",
        "equity": 108.0,
        "is_oos": True,
    }


def test_historical_weight_normalization_warning_is_sanitized_from_completed_runs(tmp_path):
    client, _ = create_test_client(tmp_path)
    strategy = create_momentum_strategy(client, idempotency_key="historical-warning-sanitize")["strategy"]
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    run_id = "run_historical_weight_warning"

    _insert_backtest_run(
        client,
        run_id=run_id,
        strategy_id=strategy["id"],
        created_at=created_at,
        is_permanent=1,
        artifact_paths=[],
    )

    client.app.state.service.storage.execute(
        """
        UPDATE backtest_runs
        SET status = ?,
            request_json = ?,
            preview_json = ?,
            warnings_json = ?
        WHERE id = ?
        """,
        (
            "COMPLETED_WITH_WARNINGS",
            json.dumps({"parameter_version_id": strategy["current_parameter_version_id"]}),
            json.dumps(
                {
                    "parameter_version_id": strategy["current_parameter_version_id"],
                    "warnings": ["Allocation weights were normalized to 100%."],
                }
            ),
            json.dumps(["Allocation weights were normalized to 100%."]),
            run_id,
        ),
    )

    listed_runs = assert_ok(client.get("/backtest-runs"))
    listed_run = next(item for item in listed_runs if item["id"] == run_id)
    detail = assert_ok(client.get(f"/backtest-runs/{run_id}/detail"))
    strategies = assert_ok(client.get("/strategies"))
    strategy_item = next(item for item in strategies if item["id"] == strategy["id"])
    summary = strategy_item["latest_completed_run_summary"]

    assert listed_run["status"] == "COMPLETED"
    assert listed_run["warnings"] == []
    assert detail["status"] == "COMPLETED"
    assert detail["warnings"] == []
    assert detail["preview"]["warnings"] == []
    assert summary["status"] == "COMPLETED"
    assert summary["warning_count"] == 0


def test_snapshot_overview_contract_is_exact_on_fresh_database(tmp_path):
    client, _ = create_test_client(tmp_path)

    overview = assert_ok(client.get("/data-snapshots/overview"))

    assert_snapshot_overview_contract(overview)
    assert overview["overall_status"] == "INCOMPLETE"
    assert [item["id"] for item in overview["dataset_snapshots"]] == [
        "ds-corporate-actions",
        "ds-price",
        "ds-index-valuations",
    ]
    assert [item["id"] for item in overview["universe_snapshots"]] == ["un-sp500", "un-ndx100"]
    assert overview["latest_job"] is None
    assert overview["blocking_code"] == "SNAPSHOT_REFRESH_REQUIRED"
    assert overview["allowed_actions"] == ["refresh_snapshots"]
    provider_summary = overview["provider_readiness_summary"]
    assert provider_summary["provider_count"] >= 1
    assert provider_summary["openbb"]["enabled"] is False
    assert provider_summary["openbb"]["credential_ready_provider_count"] == 0
    assert provider_summary["openbb"]["usable_provider_count"] == 0
    assert provider_summary["openbb"]["attempt_event_count"] == 0
    trust_summary = overview["data_trust_summary"]
    assert trust_summary["summary_label"] == "数据可信层"
    assert {item["id"] for item in trust_summary["layers"]} >= {
        "price_primary_chain",
        "membership_history",
        "delisted_identity",
        "long_history_patch",
        "precision_repair",
    }
    price_layer = next(item for item in trust_summary["layers"] if item["id"] == "price_primary_chain")
    assert price_layer["preferred_provider"] == "tiingo"
    assert [item["layer_id"] for item in overview["data_layer_readiness"]] == [
        "l1_market_data",
        "l2_fundamental_data",
        "l3_sentiment_data",
        "l4_macro_derivatives",
    ]
    by_layer = {item["layer_id"]: item for item in overview["data_layer_readiness"]}
    pit_overview = assert_ok(client.get("/pit-data"))
    pit_by_layer = {item["layer_id"]: item for item in pit_overview["pit_layer_readiness"]}
    assert by_layer["l1_market_data"]["status"] in {"READY", "WARNING", "BLOCKED"}
    assert by_layer["l3_sentiment_data"]["status"] == pit_by_layer["l3_sentiment_data"]["status"]
    assert by_layer["l3_sentiment_data"]["metrics"][0]["value"] == "0/3"
    assert by_layer["l4_macro_derivatives"]["status"] == pit_by_layer["l4_macro_derivatives"]["status"]
    l4_metrics = {item["label"]: item["value"] for item in by_layer["l4_macro_derivatives"]["metrics"]}
    assert l4_metrics["宏观利率数据"] == "0 / 10 覆盖"
    assert l4_metrics["通过标准"] == "10 / 10"
    assert {item["code"] for item in overview["snapshot_quality_alerts"]} >= {
        "FUNDAMENTAL_BALANCE_CHECK_PENDING",
        "CONSENSUS_BLIND_SPOT",
        "SHORT_VOLUME_JUMP_REVIEW",
        "RATE_BETA_CALIBRATING",
    }
    fundamental_alert = next(
        item for item in overview["snapshot_quality_alerts"] if item["code"] == "FUNDAMENTAL_BALANCE_CHECK_PENDING"
    )
    assert fundamental_alert["title_cn"] in {"财务平衡校验不可用", "财务平衡校验部分可用"}
    assert "待复核" not in fundamental_alert["title_cn"]
    assert "可用部分" in fundamental_alert["detail_cn"]
    assert "阻塞点" in fundamental_alert["detail_cn"]
    consensus_alert = next(item for item in overview["snapshot_quality_alerts"] if item["code"] == "CONSENSUS_BLIND_SPOT")
    assert consensus_alert["blocking"] is True
    assert "0/3" in consensus_alert["detail_cn"]
    assert "ALPHAVANTAGE_API_KEY" in consensus_alert["operator_action_cn"]
    rate_alert = next(item for item in overview["snapshot_quality_alerts"] if item["code"] == "RATE_BETA_CALIBRATING")
    assert "0 / 10" in rate_alert["detail_cn"]
    factor_dimensions = {item["dimension_id"]: item for item in overview["factor_dimension_readiness"]}
    assert factor_dimensions["price_liquidity"]["status"] in {"READY", "WARNING", "BLOCKED"}
    assert factor_dimensions["quality_valuation"]["linked_layers"] == ["l2_fundamental_data"]
    assert factor_dimensions["macro_derivatives"]["status"] in {"CALIBRATING", "BLOCKED"}


def test_snapshot_provider_registry_and_attempts_are_available_on_fresh_database(tmp_path, monkeypatch):
    for env_name in (
        "TIINGO_API_TOKEN",
        "FMP_API_KEY",
        "SEC_USER_AGENT",
        "MASSIVE_API_KEY",
        "NASDAQ_DATA_LINK_API_KEY",
        "FINNHUB_API_KEY",
    ):
        monkeypatch.delenv(env_name, raising=False)

    client, _ = create_test_client(tmp_path)

    registry = assert_ok(client.get("/data-snapshots/provider-registry"))
    attempts = assert_ok(client.get("/data-snapshots/provider-attempts"))

    assert registry["openbb_enabled"] is False
    assert {item["provider_id"] for item in registry["items"]} >= {
        "fake_yahoo",
        "openbb_index_constituents",
        "github_sp500_historical_components",
        "kaggle_huge_stock_market_dataset",
        "nasdaq_wiki",
        "finnhub",
        "polygon",
    }
    openbb_index = next(item for item in registry["items"] if item["provider_id"] == "openbb_index_constituents")
    assert openbb_index["enabled"] is False
    assert openbb_index["credential_ready"] is False
    assert openbb_index["usable"] is False
    assert openbb_index["readiness_status"] == "disabled"
    assert openbb_index["pit_permission"]["mode"] == "metadata_only"
    assert openbb_index["pit_permission"]["can_upgrade_pit_readiness"] is False
    assert openbb_index["credential_requirements"]["required_env_vars"] == ["FMP_API_KEY"]
    kaggle_bulk = next(item for item in registry["items"] if item["provider_id"] == "kaggle_huge_stock_market_dataset")
    assert kaggle_bulk["source_governance"]["source_manifest_required"] is True
    assert kaggle_bulk["pit_permission"]["mode"] == "price_only"
    assert kaggle_bulk["trust_profile"]["can_upgrade_full_ready"] is False
    tiingo = next(item for item in registry["items"] if item["provider_id"] == "tiingo")
    assert tiingo["trust_profile"]["trust_tier"] == "primary_eod_action"
    assert tiingo["trust_profile"]["missing_env_vars"] == ["TIINGO_API_TOKEN"]
    fmp_constituent = next(item for item in registry["items"] if item["provider_id"] == "fmp_historical_constituent")
    assert fmp_constituent["access_tier"] == "free_account"
    assert fmp_constituent["trust_profile"]["can_upgrade_full_ready"] is False
    stooq = next(item for item in registry["items"] if item["provider_id"] == "stooq")
    assert stooq["trust_profile"]["trust_tier"] == "long_history_price_patch"
    nasdaq_wiki = next(item for item in registry["items"] if item["provider_id"] == "nasdaq_wiki")
    assert nasdaq_wiki["credential_requirements"]["required_env_vars"] == ["NASDAQ_DATA_LINK_API_KEY"]
    assert nasdaq_wiki["credential_ready"] is False
    assert nasdaq_wiki["pit_permission"]["mode"] == "price_only"
    assert nasdaq_wiki["trust_profile"]["trust_tier"] == "long_history_price_patch"
    finnhub = next(item for item in registry["items"] if item["provider_id"] == "finnhub")
    assert finnhub["credential_requirements"]["required_env_vars"] == ["FINNHUB_API_KEY"]
    assert finnhub["credential_ready"] is False
    assert finnhub["pit_permission"]["mode"] == "identity_only"
    assert finnhub["trust_profile"]["trust_tier"] == "identity_listing_crosscheck"
    sec = next(item for item in registry["items"] if item["provider_id"] == "sec_edgar")
    assert sec["credential_requirements"]["required_env_vars"] == ["SEC_USER_AGENT"]
    assert sec["trust_profile"]["trust_tier"] == "identity_lifecycle_authority"
    polygon = next(item for item in registry["items"] if item["provider_id"] == "polygon")
    assert polygon["credential_requirements"]["required_env_vars"] == ["MASSIVE_API_KEY"]
    assert polygon["source_governance"]["license"] == "account_terms"
    assert attempts["latest_job_id"] is None
    assert attempts["items"] == []
    assert attempts["rollup"]["policy"] == "unique_provider_latest_job_priority"
    assert attempts["rollup"]["event_count"] == 0
    assert attempts["rollup"]["unique_provider_count"] == 0


def test_snapshot_overview_surfaces_persisted_phase2_dataset_evidence(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    repository = service.market_data_repository
    repository.replace_signal_snapshot(
        {
            "id": "ds-analyst-consensus",
            "name": "分析师预期样本",
            "status": "READY",
            "as_of": "2026-05-13",
            "freshness_label": "unit-test",
            "start_date": "2026-05-01",
            "end_date": "2026-05-13",
            "row_count": 1,
            "source": "unit_test",
            "fallback_source": "none",
            "metadata": {"covered_symbol_count": 1, "total_symbol_count": 1},
        },
        signal_points=[
            {
                "entity_key": "AAPL",
                "date": "2026-05-13",
                "publish_date": "2026-05-13",
                "available_at": "2026-05-13",
                "metric_key": "eps_surprise_pct",
                "metric_value": 0.05,
                "source": "unit_test",
            }
        ],
        signal_coverage=[
            {
                "entity_key": "AAPL",
                "start_date": "2026-05-13",
                "end_date": "2026-05-13",
                "observation_count": 1,
                "source": "unit_test",
            }
        ],
    )
    if hasattr(service, "_invalidate_snapshot_overview_cache"):
        service._invalidate_snapshot_overview_cache()

    overview = assert_ok(client.get("/data-snapshots/overview"))

    dataset_ids = [item["id"] for item in overview["dataset_snapshots"]]
    assert "ds-analyst-consensus" in dataset_ids
    l3_layer = next(item for item in overview["data_layer_readiness"] if item["layer_id"] == "l3_sentiment_data")
    evidence_items = list(l3_layer.get("linked_target_evidence") or [])
    analyst_evidence = next(item for item in evidence_items if item["dataset_id"] == "ds-analyst-consensus")
    assert analyst_evidence["evidence_kind"] == "dataset_snapshot"


def test_snapshot_overview_uses_macro_series_coverage_for_rate_beta(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    repository = service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "Price PIT data",
            "status": "READY",
            "as_of": "2026-05-14",
            "freshness_label": "unit-test",
            "start_date": "2026-05-10",
            "end_date": "2026-05-12",
            "row_count": 1,
            "source": "unit_test_price",
            "fallback_source": None,
            "metadata": {"covered_symbol_count": 1, "total_symbol_count": 1},
        },
        price_bars=[
            {
                "symbol": "SPY",
                "date": "2026-05-12",
                "open": 100.0,
                "high": 101.0,
                "low": 99.0,
                "close": 100.5,
                "adj_close": 100.5,
                "volume": 1000,
                "source": "unit_test_price",
            }
        ],
    )
    series_ids = ["DGS2", "DGS10", "FEDFUNDS", "SOFR"]
    signal_points = [
        {
            "entity_key": series_id,
            "date": f"2026-05-{day:02d}",
            "publish_date": f"2026-05-{day:02d}",
            "available_at": f"2026-05-{day:02d}",
            "metric_key": "rate_value",
            "metric_value": 4.0 + index / 100,
            "source": "unit_test_fred",
        }
        for index, series_id in enumerate(series_ids, start=1)
        for day in range(10, 13)
    ]
    repository.replace_signal_snapshot(
        {
            "id": "ds-macro-rates",
            "name": "FRED macro rates",
            "status": "READY",
            "as_of": "2026-05-14",
            "freshness_label": "unit-test",
            "start_date": "2026-05-10",
            "end_date": "2026-05-12",
            "row_count": len(signal_points),
            "source": "fred_macro_series",
            "fallback_source": None,
            "metadata": {
                "covered_symbol_count": 4,
                "total_symbol_count": 10,
                "pit_gate_status": "READY",
            },
        },
        signal_points=signal_points,
        signal_coverage=[
            {
                "entity_key": series_id,
                "start_date": "2026-05-10",
                "end_date": "2026-05-12",
                "observation_count": 3,
                "source": "unit_test_fred",
            }
            for series_id in series_ids
        ],
    )
    if hasattr(service, "_invalidate_snapshot_overview_cache"):
        service._invalidate_snapshot_overview_cache()

    overview = assert_ok(client.get("/data-snapshots/overview"))

    l4_layer = next(item for item in overview["data_layer_readiness"] if item["layer_id"] == "l4_macro_derivatives")
    l4_metrics = {item["label"]: item["value"] for item in l4_layer["metrics"]}
    pit = assert_ok(client.get("/pit-data"))
    pit_l4_layer = next(item for item in pit["pit_layer_readiness"] if item["layer_id"] == "l4_macro_derivatives")
    assert l4_layer["status"] == pit_l4_layer["status"]
    assert l4_metrics["利率 Beta"] == "校准中"
    assert l4_metrics["宏观利率数据"] == "4 / 10 覆盖"
    assert l4_layer["evidence_status"]["macro_point_rows"] == 12
    assert l4_layer["evidence_status"]["macro_covered_series"] == 4
    assert l4_layer["evidence_status"]["macro_required_series"] == 10
    assert l4_layer["evidence_status"]["macro_rates"] == "CALIBRATING"
    rate_alert = next(item for item in overview["snapshot_quality_alerts"] if item["code"] == "RATE_BETA_CALIBRATING")
    assert "宏观利率数据当前 4 / 10 覆盖" in rate_alert["detail_cn"]
    assert rate_alert["blocking"] is False
    factor_dimensions = {item["dimension_id"]: item for item in overview["factor_dimension_readiness"]}
    assert factor_dimensions["macro_derivatives"]["status"] == pit_l4_layer["status"]
    linkage = {item["check_id"]: item for item in pit["snapshot_layer_linkage"]}
    assert linkage["rate_beta_calibration"]["result_status"] != "READY"


def test_snapshot_l4_macro_evidence_is_not_blocked_by_l1_price_state(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    repository = service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "Price PIT data",
            "status": "BLOCKED",
            "as_of": "2026-05-14",
            "freshness_label": "unit-test",
            "start_date": None,
            "end_date": None,
            "row_count": 0,
            "source": "unit_test_price",
            "fallback_source": None,
            "metadata": {"covered_symbol_count": 0, "total_symbol_count": 1},
        },
        price_bars=[],
    )
    series_ids = [
        "DGS1MO",
        "DGS3MO",
        "DGS6MO",
        "DGS1",
        "DGS2",
        "DGS5",
        "DGS10",
        "DGS30",
        "FEDFUNDS",
        "SOFR",
    ]
    signal_points = [
        {
            "entity_key": series_id,
            "date": "2026-05-14",
            "publish_date": "2026-05-14",
            "available_at": "2026-05-14",
            "metric_key": "rate_value",
            "metric_value": 4.0 + index / 100,
            "source": "unit_test_fred",
        }
        for index, series_id in enumerate(series_ids, start=1)
    ]
    repository.replace_signal_snapshot(
        {
            "id": "ds-macro-rates",
            "name": "FRED macro rates",
            "status": "READY",
            "as_of": "2026-05-14",
            "freshness_label": "unit-test",
            "start_date": "2026-05-14",
            "end_date": "2026-05-14",
            "row_count": len(signal_points),
            "source": "fred_macro_series",
            "fallback_source": None,
            "metadata": {
                "covered_symbol_count": len(series_ids),
                "total_symbol_count": len(series_ids),
                "pit_gate_status": "READY",
            },
        },
        signal_points=signal_points,
        signal_coverage=[
            {
                "entity_key": series_id,
                "start_date": "2026-05-14",
                "end_date": "2026-05-14",
                "observation_count": 1,
                "source": "unit_test_fred",
            }
            for series_id in series_ids
        ],
    )
    if hasattr(service, "_invalidate_snapshot_overview_cache"):
        service._invalidate_snapshot_overview_cache()

    overview = assert_ok(client.get("/data-snapshots/overview"))

    l4_layer = next(item for item in overview["data_layer_readiness"] if item["layer_id"] == "l4_macro_derivatives")
    l4_metrics = {item["label"]: item["value"] for item in l4_layer["metrics"]}
    assert l4_layer["status"] == "CALIBRATING"
    assert l4_metrics["利率 Beta"] == "校准中"
    assert l4_metrics["宏观利率数据"] == "10 / 10 覆盖"
    assert "不按硬阻塞处理" in l4_layer["summary"]
    factor_dimensions = {item["dimension_id"]: item for item in overview["factor_dimension_readiness"]}
    assert factor_dimensions["price_liquidity"]["status"] == "BLOCKED"
    assert factor_dimensions["macro_derivatives"]["status"] == "CALIBRATING"
    assert factor_dimensions["macro_derivatives"]["blockers"] == []
    assert "不按硬阻塞处理" in factor_dimensions["macro_derivatives"]["summary"]


def test_snapshot_refresh_lands_phase2_dataset_rows_and_pit_gates(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    monkeypatch.setattr(
        service,
        "_fetch_fmp_fundamental_points",
        lambda *, symbols, as_of: [
            {
                "symbol": "AAPL",
                "date": "2026-03-31",
                "period_end_date": "2026-03-31",
                "publish_date": "2026-05-01",
                "statement_date": "2026-03-31",
                "available_at": "2026-05-01",
                "fiscal_year": 2026,
                "fiscal_period": "Q1",
                "time_provenance": "unit_test",
                "ltm_earnings": 10.0,
                "revenue": 100.0,
                "gross_profit": 45.0,
                "net_income": 12.0,
                "market_cap": 2_000_000.0,
                "book_value_equity": 60.0,
                "operating_cash_flow": 15.0,
                "capex": -2.0,
                "enterprise_value": 2_100_000.0,
                "total_shares": 1_000_000.0,
                "shares_outstanding": 1_000_000.0,
                "total_assets": 120.0,
                "current_assets": 40.0,
                "current_liabilities": 20.0,
                "long_term_debt": 10.0,
                "total_debt": 15.0,
                "cash_and_equivalents": 5.0,
                "source": "unit_test_fmp",
            }
        ],
    )
    monkeypatch.setattr(
        service,
        "_fetch_alpha_vantage_consensus_points",
        lambda *, symbols, as_of: [
            {
                "entity_key": "AAPL",
                "date": f"2026-03-{day:02d}",
                "publish_date": "2026-04-15",
                "available_at": "2026-04-15",
                "metric_key": f"eps_surprise_pct_{index}",
                "metric_value": 0.07 + index / 100,
                "source": "unit_test_alpha",
            }
            for index, day in enumerate(range(29, 32), start=1)
        ],
    )
    monkeypatch.setattr(
        service,
        "_fetch_finra_short_volume_points",
        lambda *, symbols, as_of: [
            {
                "entity_key": "AAPL",
                "date": "2026-05-13",
                "publish_date": "2026-05-13",
                "available_at": "2026-05-14",
                "metric_key": "short_volume_ratio",
                "metric_value": 0.42,
                "source": "unit_test_finra",
            }
        ],
    )
    monkeypatch.setattr(
        service,
        "_fetch_fred_macro_rate_points",
        lambda *, symbols, as_of: [
            {
                "entity_key": f"FRED_SERIES_{series_index:02d}",
                "date": "2026-05-13",
                "publish_date": "2026-05-13",
                "available_at": "2026-05-13",
                "metric_key": "rate_value",
                "metric_value": 4.0 + series_index / 100,
                "source": "unit_test_fred",
            }
            for series_index in range(1, 11)
        ],
    )
    monkeypatch.setattr(
        service,
        "_fetch_polygon_option_skew_points",
        lambda *, symbols, as_of: [
            {
                "entity_key": "AAPL",
                "date": "2026-05-13",
                "publish_date": "2026-05-13",
                "available_at": "2026-05-13",
                "metric_key": "iv_skew_put_call_25d",
                "metric_value": 0.04,
                "source": "unit_test_polygon",
            }
        ],
    )

    refreshed = assert_ok(
        client.post(
            "/admin/snapshot-refresh-jobs",
            json={
                "mode": "repair",
                "targets": ["fundamentals", "sentiment", "macro_derivatives"],
                "symbols": ["AAPL"],
                "phase2_max_symbols": 1,
            },
        )
    )

    dataset_ids = {item["id"] for item in refreshed["dataset_snapshots"]}
    assert {
        "ds-fundamentals",
        "ds-analyst-consensus",
        "ds-short-volume",
        "ds-macro-rates",
        "ds-option-skew",
    } <= dataset_ids
    refresh_datasets = refreshed["latest_job"]["summary"]["refresh_stats"]["datasets"]
    assert refresh_datasets["ds-analyst-consensus"]["provider_summary"]["providers"]["alpha_vantage"]["status"] == "succeeded"
    assert refresh_datasets["ds-option-skew"]["provider_summary"]["providers"]["polygon"]["landed_row_count"] == 1

    layers = {item["layer_id"]: item for item in refreshed["data_layer_readiness"]}
    assert layers["l2_fundamental_data"]["status"] == "READY"
    assert layers["l3_sentiment_data"]["status"] == "READY"
    assert layers["l4_macro_derivatives"]["status"] in {"READY", "BLOCKED", "CALIBRATING"}
    assert layers["l3_sentiment_data"]["evidence_status"]["short_volume"] == "READY"
    refreshed_alert_codes = {item["code"] for item in refreshed["snapshot_quality_alerts"]}
    assert "CONSENSUS_BLIND_SPOT" not in refreshed_alert_codes
    assert "SHORT_VOLUME_JUMP_REVIEW" not in refreshed_alert_codes

    pit = assert_ok(client.get("/pit-data"))
    linkage = {item["check_id"]: item for item in pit["snapshot_layer_linkage"]}
    assert linkage["fundamental_publish_gate"]["result_status"] == "READY"
    assert linkage["consensus_sample_gate"]["result_status"] == "READY"
    assert linkage["short_volume_gate"]["result_status"] == "READY"
    assert linkage["rate_beta_calibration"]["result_status"] == "READY"
    assert linkage["iv_skew_feed"]["result_status"] == "READY"


def test_fundamental_snapshot_progress_backfill_uses_fundamental_coverage_rows(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    service.market_data_repository.replace_fundamental_snapshot(
        {
            "id": "ds-fundamentals",
            "name": "Fundamental PIT data",
            "status": "READY",
            "as_of": "2026-05-15",
            "freshness_label": "phase2 refresh",
            "start_date": "2026-01-01",
            "end_date": "2026-03-31",
            "row_count": 96,
            "source": "sec_edgar",
            "fallback_source": None,
            "metadata": {
                "covered_symbol_count": 0,
                "total_symbol_count": 3,
                "missing_symbols": ["AAPL", "MSFT", "NVDA"],
                "available_fields": ["market_cap"],
            },
        },
        fundamental_coverage=[
            {
                "symbol": "AAPL",
                "start_date": "2026-01-01",
                "end_date": "2026-03-31",
                "observation_count": 48,
                "fields": ["market_cap"],
                "source": "sec_edgar",
            },
            {
                "symbol": "MSFT",
                "start_date": "2026-01-01",
                "end_date": "2026-03-31",
                "observation_count": 48,
                "fields": ["market_cap"],
                "source": "sec_edgar",
            },
        ],
    )

    snapshot = next(
        item
        for item in service.market_data_repository.list_dataset_snapshots()
        if item["id"] == "ds-fundamentals"
    )
    backfilled = service._backfill_dataset_snapshot_progress(
        snapshot,
        target_symbols=["AAPL", "MSFT", "NVDA"],
    )

    metadata = backfilled["metadata"]
    assert metadata["covered_symbol_count"] == 2
    assert metadata["total_symbol_count"] == 3
    assert metadata["missing_symbols"] == ["NVDA"]


def test_phase2_fundamental_batches_merge_without_replacing_prior_symbols(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    def fake_sec_points(*, symbols, as_of):
        rows = []
        for symbol in symbols:
            rows.append(
                {
                    "symbol": symbol,
                    "date": "2026-03-31",
                    "period_end_date": "2026-03-31",
                    "publish_date": "2026-05-01",
                    "statement_date": "2026-03-31",
                    "available_at": "2026-05-01",
                    "fiscal_year": 2026,
                    "fiscal_period": "Q1",
                    "time_provenance": "unit_test_sec_companyfacts",
                    "revenue": 100.0,
                    "net_income": 12.0,
                    "total_assets": 120.0,
                    "current_liabilities": 20.0,
                    "book_value_equity": 60.0,
                    "source": "sec_edgar",
                }
            )
        return rows

    monkeypatch.setattr(service, "_fetch_sec_edgar_fundamental_points", fake_sec_points)
    monkeypatch.setattr(service, "_fetch_fmp_fundamental_points", lambda *, symbols, as_of: [])

    first = assert_ok(
        client.post(
            "/admin/snapshot-refresh-jobs",
            json={
                "mode": "repair",
                "targets": ["fundamentals"],
                "phase2_scope": "custom",
                "symbols": ["TESTA", "TESTB"],
                "phase2_max_symbols": 1,
            },
        )
    )
    first_summary = first["latest_job"]["summary"]["refresh_stats"]["datasets"]["ds-fundamentals"]["provider_summary"]
    assert first_summary["covered_symbol_count"] == 1
    assert first_summary["target_symbol_count"] == 2
    assert first_summary["next_cursor"] == "1"

    second = assert_ok(
        client.post(
            "/admin/snapshot-refresh-jobs",
            json={
                "mode": "repair",
                "targets": ["fundamentals"],
                "phase2_scope": "custom",
                "symbols": ["TESTA", "TESTB"],
                "phase2_max_symbols": 1,
                "phase2_cursor": "1",
            },
        )
    )
    second_summary = second["latest_job"]["summary"]["refresh_stats"]["datasets"]["ds-fundamentals"]["provider_summary"]
    assert second_summary["covered_symbol_count"] == 2
    assert second_summary["coverage_pct"] == 100.0
    assert second_summary["next_cursor"] is None
    coverage = service.market_data_repository.load_dataset_fundamental_coverage("ds-fundamentals")
    assert {"TESTA", "TESTB"} <= {row["symbol"] for row in coverage}

    assert_ok(
        client.post(
            "/admin/snapshot-refresh-jobs",
            json={
                "mode": "repair",
                "targets": ["fundamentals"],
                "phase2_scope": "custom",
                "symbols": ["TESTA"],
                "phase2_max_symbols": 1,
            },
        )
    )
    snapshot = next(
        row
        for row in service.market_data_repository.list_dataset_snapshots()
        if row["id"] == "ds-fundamentals"
    )
    assert snapshot["metadata"]["covered_symbol_count"] >= 2
    assert snapshot["metadata"]["total_symbol_count"] == snapshot["metadata"]["covered_symbol_count"]


def test_phase2_fundamentals_use_fdic_bankfind_after_sec_and_fmp_gap(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    monkeypatch.setattr(service, "_fetch_sec_edgar_fundamental_points", lambda *, symbols, as_of: [])
    monkeypatch.setattr(service, "_fetch_fmp_fundamental_points", lambda *, symbols, as_of: [])

    def fake_request(url, params, *, timeout=20):
        assert "banks.data.fdic.gov/api/financials" in url
        assert "CERT:59017" in params["filters"]
        return {
            "data": [
                {
                    "data": {
                        "CERT": 59017,
                        "REPDTE": "20221231",
                        "ASSET": 212638872,
                        "NETINC": 1665627,
                        "EQ": 17445927,
                        "LIAB": 195192945,
                        "CHBAL": 4283201,
                    }
                }
            ]
        }

    monkeypatch.setattr(service, "_request_phase2_json", fake_request)

    result = service._refresh_phase2_fundamentals(
        symbols=["FRC"],
        as_of="2026-05-15T00:00:00Z",
        phase2_context={"_target_symbols": ["FRC"], "target_symbol_count": 1},
    )

    assert result["provider_summary"]["providers"]["fdic_bankfind"]["status"] == "succeeded"
    coverage = service.market_data_repository.load_dataset_fundamental_coverage("ds-fundamentals")
    assert {row["symbol"] for row in coverage} == {"FRC"}
    rows = service.market_data_repository.load_dataset_fundamental_points("ds-fundamentals")
    point = rows["FRC"][0]
    assert point["source"] == "fdic_bankfind"
    assert point["available_at"] == "2023-02-14"
    assert point["total_assets"] == 212638872000.0
    assert point["book_value_equity"] == 17445927000.0


def test_phase2_fred_macro_rates_requests_ten_series(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    monkeypatch.setenv("FRED_API_KEY", "token")
    requested_series: list[str] = []

    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return json.dumps(
                {
                    "observations": [
                        {
                            "realtime_start": "2026-05-13",
                            "date": "2026-05-13",
                            "value": "4.25",
                        }
                    ]
                }
            ).encode("utf-8")

    def fake_urlopen(request, timeout):
        parsed = real_service_module.urllib.parse.urlparse(request.full_url)
        params = real_service_module.urllib.parse.parse_qs(parsed.query)
        requested_series.append(params["series_id"][0])
        assert params["file_type"] == ["json"]
        assert params["sort_order"] == ["asc"]
        return _Response()

    monkeypatch.setattr(real_service_module.urllib.request, "urlopen", fake_urlopen)

    points = service._fetch_fred_macro_rate_points(symbols=[], as_of="2026-05-14T00:00:00Z")

    assert requested_series == list(real_service_module.FRED_MACRO_RATE_SERIES)
    assert len({point["entity_key"] for point in points}) == 10
    assert all(point["publish_date"] == "2026-05-13" for point in points)


def test_snapshot_refresh_keeps_missing_time_signal_rows_out_of_dataset_snapshots(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    monkeypatch.setattr(
        service,
        "_fetch_alpha_vantage_consensus_points",
        lambda *, symbols, as_of: [
            {
                "entity_key": "AAPL",
                "date": "2026-03-31",
                "metric_key": "eps_surprise_pct",
                "metric_value": 0.07,
                "source": "unit_test_alpha",
            }
        ],
    )
    monkeypatch.setattr(service, "_fetch_finra_short_volume_points", lambda *, symbols, as_of: [])

    refreshed = assert_ok(
        client.post(
            "/admin/snapshot-refresh-jobs",
            json={"mode": "repair", "targets": ["sentiment"], "symbols": ["AAPL"]},
        )
    )

    dataset_ids = {item["id"] for item in refreshed["dataset_snapshots"]}
    assert "ds-analyst-consensus" not in dataset_ids
    refresh_datasets = refreshed["latest_job"]["summary"]["refresh_stats"]["datasets"]
    provider_payload = refresh_datasets["ds-analyst-consensus"]["provider_summary"]["providers"]["alpha_vantage"]
    assert provider_payload["status"] == "empty"
    assert provider_payload["reason"] == "provider_returned_rows_without_publish_date_or_available_at"
    l3_layer = next(item for item in refreshed["data_layer_readiness"] if item["layer_id"] == "l3_sentiment_data")
    evidence = next(item for item in l3_layer["linked_target_evidence"] if item["dataset_id"] == "ds-analyst-consensus")
    assert evidence["evidence_kind"] == "readiness_only_provider_attempt"


def test_phase2_finra_short_volume_request_uses_browser_user_agent(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    captured_headers: dict[str, str] = {}

    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self):
            return b"Date|Symbol|ShortVolume|ShortExemptVolume|TotalVolume|Market\r\n20260513|AAPL|10|0|100|Q\r\n"

    def fake_urlopen(request, timeout):
        nonlocal captured_headers
        captured_headers = {key.lower(): value for key, value in request.header_items()}
        return _Response()

    monkeypatch.setattr(real_service_module.urllib.request, "urlopen", fake_urlopen)

    points = service._fetch_finra_short_volume_points(symbols=["AAPL"], as_of="2026-05-13T00:00:00Z")

    assert "mozilla/5.0" in captured_headers["user-agent"].lower()
    ratio = next(item for item in points if item["metric_key"] == "short_volume_ratio")
    assert ratio["metric_value"] == 0.1
    assert ratio["publish_date"] == "2026-05-13"
    assert ratio["available_at"] == "2026-05-14"


def test_phase2_sec_edgar_continues_after_unmapped_symbol(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    class FakeSecProvider:
        def fetch_fundamental_points(self, symbol, *, start_date, end_date, max_periods):
            if symbol == "BAD":
                raise RuntimeError("No SEC identity mapping available for BAD.")
            return [
                {
                    "symbol": symbol,
                    "date": "2026-03-31",
                    "period_end_date": "2026-03-31",
                    "publish_date": "2026-05-01",
                    "available_at": "2026-05-01",
                    "revenue": 100.0,
                    "net_income": 12.0,
                    "source": "sec_edgar",
                }
            ]

    monkeypatch.setattr(real_service_module, "SecEdgarProvider", FakeSecProvider)

    points = service._fetch_sec_edgar_fundamental_points(symbols=["BAD", "GOOD"], as_of="2026-05-14T00:00:00Z")

    assert [point["symbol"] for point in points] == ["GOOD"]


def test_phase2_alpha_vantage_rate_limit_uses_price_momentum_proxy(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    start = date(2025, 8, 29)
    price_bars = []
    for index in range(260):
        current_date = start + timedelta(days=index)
        price_bars.append(
            {
                "symbol": "AAPL",
                "date": current_date.isoformat(),
                "open": 100.0 + index,
                "high": 101.0 + index,
                "low": 99.0 + index,
                "close": 100.0 + index,
                "adj_close": 100.0 + index,
                "volume": 1000 + index,
                "source": "unit_test_price",
            }
        )
        price_bars.append(
            {
                "symbol": "SPY",
                "date": current_date.isoformat(),
                "open": 400.0 + index / 2,
                "high": 401.0 + index / 2,
                "low": 399.0 + index / 2,
                "close": 400.0 + index / 2,
                "adj_close": 400.0 + index / 2,
                "volume": 2000 + index,
                "source": "unit_test_price",
            }
        )
    service.market_data_repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "Price PIT data",
            "status": "READY",
            "as_of": "2026-05-14",
            "freshness_label": "unit test",
            "start_date": start.isoformat(),
            "end_date": (start + timedelta(days=259)).isoformat(),
            "row_count": len(price_bars),
            "source": "unit_test_price",
            "fallback_source": None,
            "metadata": {},
        },
        price_bars=price_bars,
    )

    class FakeAlphaProvider:
        def fetch_earnings_estimates(self, symbol):
            raise RuntimeError("Alpha Vantage rate limit reached: free-tier quota or pacing limit exceeded.")

    monkeypatch.setattr(real_service_module, "AlphaVantageProvider", FakeAlphaProvider)

    points = service._fetch_alpha_vantage_consensus_points(symbols=["AAPL"], as_of="2026-05-14T00:00:00Z")

    assert {point["metric_key"] for point in points} == {
        "earnings_surprise_proxy_excess_return_1q",
        "earnings_surprise_proxy_excess_return_2q",
        "earnings_surprise_proxy_excess_return_3q",
        "earnings_surprise_proxy_excess_return_4q",
    }
    assert {point["source"] for point in points} == {"price_momentum_proxy"}
    assert all(point["metadata"]["benchmark_symbol"] == "SPY" for point in points)


def test_phase2_option_skew_falls_back_to_cboe_and_benchmark_proxy(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    class FakePolygonProvider:
        def _request_json(self, path, params):
            raise RuntimeError("Unknown API Key")

    def option_payload(root: str, call_iv: float, put_iv: float) -> dict[str, Any]:
        return {
            "data": {
                "timestamp": "2026-05-14T20:00:00Z",
                "options": [
                    {"option": f"{root}260612C00100000", "iv": call_iv, "delta": 0.24},
                    {"option": f"{root}260612P00100000", "iv": put_iv, "delta": -0.26},
                ],
            }
        }

    def fake_cboe(symbol: str):
        if symbol == "AAPL":
            return option_payload("AAPL", 0.20, 0.25)
        if symbol == "SPY":
            return option_payload("SPY", 0.18, 0.22)
        raise RuntimeError("CBOE chain unavailable")

    monkeypatch.setattr(real_service_module, "PolygonMarketDataProvider", FakePolygonProvider)
    monkeypatch.setattr(service, "_request_cboe_delayed_option_payload", fake_cboe)

    points = service._fetch_polygon_option_skew_points(symbols=["AAPL", "NOOPT"], as_of="2026-05-14T00:00:00Z")
    by_symbol = {}
    for point in points:
        by_symbol.setdefault(point["entity_key"], []).append(point)

    assert {point["source"] for point in by_symbol["AAPL"]} == {"cboe_delayed_quotes"}
    assert {point["source"] for point in by_symbol["NOOPT"]} == {"cboe_benchmark_proxy"}
    aapl_skew = next(point for point in by_symbol["AAPL"] if point["metric_key"] == "iv_skew_put_call_25d")
    proxy_skew = next(point for point in by_symbol["NOOPT"] if point["metric_key"] == "iv_skew_put_call_25d")
    assert round(aapl_skew["metric_value"], 4) == 0.05
    assert round(proxy_skew["metric_value"], 4) == 0.04
    assert aapl_skew["available_at"] == "2026-05-14"


def test_snapshot_provider_registry_reuses_snapshot_overview_cache(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    original_builder = service._build_snapshot_overview
    build_calls = 0

    def counted_builder(*args, **kwargs):
        nonlocal build_calls
        build_calls += 1
        return original_builder(*args, **kwargs)

    monkeypatch.setattr(service, "_build_snapshot_overview", counted_builder)

    assert_ok(client.get("/data-snapshots/overview"))
    assert build_calls == 1

    registry = assert_ok(client.get("/data-snapshots/provider-registry"))
    attempts = assert_ok(client.get("/data-snapshots/provider-attempts"))

    assert registry["items"]
    assert attempts["rollup"]["policy"] == "unique_provider_latest_job_priority"
    assert build_calls == 1


def test_snapshot_overview_build_does_not_hold_snapshot_cache_lock(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    original_builder = service._build_snapshot_overview

    def lock_checking_builder(*args, **kwargs):
        acquired = service._snapshot_overview_cache_lock.acquire(blocking=False)
        try:
            assert acquired, "/data-snapshots/overview must not hold the snapshot cache lock while rebuilding"
            return original_builder(*args, **kwargs)
        finally:
            if acquired:
                service._snapshot_overview_cache_lock.release()

    monkeypatch.setattr(service, "_build_snapshot_overview", lock_checking_builder)

    overview = assert_ok(client.get("/data-snapshots/overview"))

    assert overview["dataset_snapshots"]


def test_snapshot_overview_coalesces_concurrent_cache_miss(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service._invalidate_snapshot_overview_cache()
    monkeypatch.setattr(service, "_market_data_snapshot_cache_signature", lambda: "unit-test-market-signature")
    build_calls = 0
    build_calls_lock = threading.Lock()
    start_barrier = threading.Barrier(5)
    payload = {
        "dataset_snapshots": [{"id": "ds-price", "status": "READY"}],
        "universe_snapshots": [{"id": "un-sp500", "status": "READY"}],
        "data_trust_summary": {"layers": []},
    }
    results: list[dict[str, Any]] = []
    errors: list[BaseException] = []

    def slow_builder(*args, **kwargs):
        nonlocal build_calls
        with build_calls_lock:
            build_calls += 1
        time.sleep(0.15)
        return dict(payload)

    def worker() -> None:
        try:
            start_barrier.wait(timeout=2)
            results.append(service.get_snapshot_overview())
        except BaseException as exc:  # pragma: no cover - surfaced via assertion below
            errors.append(exc)

    monkeypatch.setattr(service, "_build_snapshot_overview", slow_builder)

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(4)]
    for thread in threads:
        thread.start()
    start_barrier.wait(timeout=2)
    for thread in threads:
        thread.join(timeout=5)

    assert all(not thread.is_alive() for thread in threads)
    assert errors == []
    assert build_calls == 1
    assert len(results) == 4
    assert all(result["dataset_snapshots"][0]["id"] == "ds-price" for result in results)


def test_snapshot_provider_registry_masks_nasdaq_wiki_finnhub_and_massive_keys(tmp_path, monkeypatch):
    monkeypatch.setenv("NASDAQ_DATA_LINK_API_KEY", "nasdaq-secret-value")
    monkeypatch.setenv("FINNHUB_API_KEY", "finnhub-secret-value")
    monkeypatch.setenv("MASSIVE_API_KEY", "massive-secret-value")
    client, _ = create_test_client(tmp_path)

    registry = assert_ok(client.get("/data-snapshots/provider-registry"))

    nasdaq_wiki = next(item for item in registry["items"] if item["provider_id"] == "nasdaq_wiki")
    finnhub = next(item for item in registry["items"] if item["provider_id"] == "finnhub")
    polygon = next(item for item in registry["items"] if item["provider_id"] == "polygon")
    assert nasdaq_wiki["credential_requirements"]["configured"] is True
    assert nasdaq_wiki["credential_requirements"]["configured_env_vars"] == ["NASDAQ_DATA_LINK_API_KEY"]
    assert nasdaq_wiki["credential_requirements"]["missing_env_vars"] == []
    assert finnhub["credential_requirements"]["configured"] is True
    assert finnhub["credential_requirements"]["configured_env_vars"] == ["FINNHUB_API_KEY"]
    assert finnhub["credential_requirements"]["missing_env_vars"] == []
    assert polygon["credential_requirements"]["configured"] is True
    assert polygon["credential_requirements"]["configured_env_vars"] == ["MASSIVE_API_KEY"]
    assert polygon["credential_requirements"]["missing_env_vars"] == []
    assert "nasdaq-secret-value" not in json.dumps(registry)
    assert "finnhub-secret-value" not in json.dumps(registry)
    assert "massive-secret-value" not in json.dumps(registry)


def test_snapshot_provider_registry_marks_rejected_massive_key_unusable(monkeypatch):
    monkeypatch.setenv("MASSIVE_API_KEY", "massive-secret-value")
    provider = SimpleNamespace(provider_name="polygon", metadata={"access_tier": "paid_optional"})

    registry = build_provider_registry(
        market_data_provider=SimpleNamespace(providers=[provider]),
        attempt_items=[
            {
                "provider_id": "polygon",
                "status": "unavailable",
                "reason": "invalid_credentials",
                "error": "invalid_credentials",
                "target_type": "price_history",
                "snapshot_id": "ds-price",
                "job_id": "snap_latest",
                "attempted_at": "2026-05-13T10:11:27Z",
                "quota_limited": False,
                "cooldown_active": False,
            }
        ],
    )

    polygon = next(item for item in registry["items"] if item["provider_id"] == "polygon")
    assert polygon["credential_requirements"]["configured"] is True
    assert polygon["credential_requirements"]["configured_env_vars"] == ["MASSIVE_API_KEY"]
    assert polygon["credential_ready"] is False
    assert polygon["usable"] is False
    assert polygon["readiness_status"] == "invalid_credentials"
    assert polygon["trust_profile"]["credential_status"] == "invalid_credentials"
    assert "massive-secret-value" not in json.dumps(registry)


def test_snapshot_overview_cache_signature_tracks_provider_env_status(tmp_path, monkeypatch):
    monkeypatch.delenv("TIINGO_API_TOKEN", raising=False)
    client, _ = create_test_client(tmp_path)

    missing_overview = assert_ok(client.get("/data-snapshots/overview"))
    missing_price_layer = next(
        item for item in missing_overview["data_trust_summary"]["layers"] if item["id"] == "price_primary_chain"
    )
    assert "TIINGO_API_TOKEN" in missing_price_layer["missing_env_vars"]

    monkeypatch.setenv("TIINGO_API_TOKEN", "local-test-token")
    configured_overview = assert_ok(client.get("/data-snapshots/overview"))
    configured_price_layer = next(
        item for item in configured_overview["data_trust_summary"]["layers"] if item["id"] == "price_primary_chain"
    )

    assert "TIINGO_API_TOKEN" not in configured_price_layer["missing_env_vars"]


def test_snapshot_trust_summary_prefers_live_provider_state_over_static_key_prompts():
    registry_items = [
        {
            "provider_id": "yahoo",
            "source_name": "Yahoo Finance",
            "credential_requirements": {
                "required_env_vars": [],
                "configured_env_vars": [],
                "missing_env_vars": [],
            },
            "quota_cooldown": {"quota_limited": False, "cooldown_active": False, "next_retry_at": None},
            "error_summary": {"status": "succeeded", "reason": None, "error": None},
            "trust_profile": {"operator_action": "保留为公开价格基线。"},
            "enabled": True,
            "credential_ready": True,
            "usable": True,
            "readiness_status": "usable",
        },
        {
            "provider_id": "tiingo",
            "source_name": "Tiingo",
            "credential_requirements": {
                "required_env_vars": ["TIINGO_API_TOKEN"],
                "configured_env_vars": ["TIINGO_API_TOKEN"],
                "missing_env_vars": [],
            },
            "quota_cooldown": {
                "quota_limited": True,
                "cooldown_active": True,
                "next_retry_at": "2026-05-11T05:37:32Z",
            },
            "error_summary": {"status": "skipped", "reason": "primary_price_source_already_selected", "error": None},
            "trust_profile": {"operator_action": "配置 TIINGO_API_TOKEN 后用于 PIT 第一修复队列。"},
            "enabled": True,
            "credential_ready": True,
            "usable": False,
            "readiness_status": "cooldown",
        },
        {
            "provider_id": "sec_edgar",
            "source_name": "SEC EDGAR",
            "credential_requirements": {
                "required_env_vars": ["SEC_USER_AGENT"],
                "configured_env_vars": ["SEC_USER_AGENT"],
                "missing_env_vars": [],
            },
            "quota_cooldown": {"quota_limited": False, "cooldown_active": False, "next_retry_at": None},
            "error_summary": {"status": "succeeded", "reason": None, "error": None},
            "trust_profile": {"operator_action": "用 SEC 生成身份生命周期证据。"},
            "enabled": True,
            "credential_ready": True,
            "usable": True,
            "readiness_status": "usable",
        },
        {
            "provider_id": "finnhub",
            "source_name": "Finnhub",
            "credential_requirements": {
                "required_env_vars": ["FINNHUB_API_KEY"],
                "configured_env_vars": ["FINNHUB_API_KEY"],
                "missing_env_vars": [],
            },
            "quota_cooldown": {"quota_limited": False, "cooldown_active": False, "next_retry_at": None},
            "error_summary": {"status": "failed", "reason": "credential_rejected", "error": "credential_rejected"},
            "trust_profile": {"operator_action": "配置 FINNHUB_API_KEY 后做身份交叉校验。"},
            "enabled": True,
            "credential_ready": True,
            "usable": True,
            "readiness_status": "usable",
        },
        {
            "provider_id": "polygon",
            "source_name": "Polygon.io",
            "credential_requirements": {
                "required_env_vars": ["MASSIVE_API_KEY"],
                "configured_env_vars": ["MASSIVE_API_KEY"],
                "missing_env_vars": [],
            },
            "quota_cooldown": {"quota_limited": False, "cooldown_active": False, "next_retry_at": None},
            "error_summary": {
                "status": "unavailable",
                "reason": "missing MASSIVE_API_KEY",
                "error": "missing MASSIVE_API_KEY",
            },
            "trust_profile": {"operator_action": "配置 Polygon 后用于关键缺口精修。"},
            "enabled": True,
            "credential_ready": True,
            "usable": True,
            "readiness_status": "usable",
        },
    ]
    attempt_items = [
        {
            "provider_id": "yahoo",
            "job_id": "snap_latest",
            "attempted_at": "2026-05-11T05:11:02Z",
            "status": "succeeded",
            "snapshot_id": "ds-price",
            "target_type": "price_history",
            "quota_limited": False,
            "cooldown_active": False,
        },
        {
            "provider_id": "tiingo",
            "job_id": "snap_latest",
            "attempted_at": "2026-05-11T05:11:02Z",
            "status": "skipped",
            "snapshot_id": "ds-price",
            "target_type": "price_history",
            "quota_limited": True,
            "cooldown_active": True,
            "next_retry_at": "2026-05-11T05:37:32Z",
        },
        {
            "provider_id": "sec_edgar",
            "job_id": "snap_latest",
            "attempted_at": "2026-05-11T05:11:02Z",
            "status": "succeeded",
            "snapshot_id": "ds-corporate-actions",
            "target_type": "corporate_actions",
            "quota_limited": False,
            "cooldown_active": False,
        },
        {
            "provider_id": "finnhub",
            "job_id": "snap_latest",
            "attempted_at": "2026-05-11T05:11:02Z",
            "status": "failed",
            "snapshot_id": "ds-price",
            "target_type": "price_history",
            "quota_limited": False,
            "cooldown_active": False,
            "reason": "credential_rejected",
            "error": "credential_rejected",
        },
        {
            "provider_id": "polygon",
            "job_id": None,
            "attempted_at": "2026-05-11T05:00:35Z",
            "status": "unavailable",
            "snapshot_id": "ds-price",
            "target_type": "price_history",
            "quota_limited": False,
            "cooldown_active": False,
            "reason": "missing MASSIVE_API_KEY",
            "error": "missing MASSIVE_API_KEY",
        },
    ]

    summary = build_data_trust_summary(registry_items=registry_items, attempt_items=attempt_items)

    price_layer = next(item for item in summary["layers"] if item["id"] == "price_primary_chain")
    assert "Yahoo Finance" in price_layer["operator_action"]
    assert "Tiingo 当前处于冷却窗口" in price_layer["operator_action"]
    assert "TIINGO_API_TOKEN" not in price_layer["operator_action"]

    identity_layer = next(item for item in summary["layers"] if item["id"] == "delisted_identity")
    assert "SEC EDGAR" in identity_layer["operator_action"]
    assert "Finnhub 当前返回凭据被拒" in identity_layer["operator_action"]
    assert "FINNHUB_API_KEY" in identity_layer["operator_action"]

    precision_layer = next(item for item in summary["layers"] if item["id"] == "precision_repair")
    assert "Polygon.io" in precision_layer["operator_action"]
    assert "本轮未命中" in precision_layer["operator_action"]
    assert "MASSIVE_API_KEY" not in precision_layer["operator_action"]


def test_snapshot_progress_targets_use_distinct_symbol_projection(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    monkeypatch.setattr(service.market_data_repository, "list_universe_membership_symbols", lambda: ["aapl", "MSFT"])

    def fail_full_membership_load(*args, **kwargs):
        raise AssertionError("overview progress must not load full universe membership rows")

    monkeypatch.setattr(service.market_data_repository, "load_universe_memberships", fail_full_membership_load)

    symbols = service._canonical_progress_target_symbols(
        progress_target_symbols=[],
        existing_price_coverage=[],
        existing_corporate_coverage=[],
        existing_price_missing=[],
        existing_corporate_missing=[],
    )

    assert {"AAPL", "MSFT"}.issubset(set(symbols))


def test_snapshot_progress_targets_include_asset_allocation_symbols(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    session = draft_strategy_session(
        client,
        strategy_type="ASSET_ALLOCATION",
        message="Create a four asset allocation model.",
        confirmation_payload={
            "revision": 1,
            "strategy_type": "ASSET_ALLOCATION",
            "core": {
                "strategy_type": "ASSET_ALLOCATION",
                "universe_name": "Global Allocation",
                "rebalance_frequency": "quarterly",
            },
            "parameters": {
                "strategy_name": "Asset allocation progress symbols",
                "strategy_description": "Progress targets should include every configured asset.",
                "benchmark_symbol": "SPY",
                "capital": 100000,
                "allocation_assets": [
                    {"symbol": "SPY", "display_name": "S&P 500 ETF", "asset_class": "Equity"},
                    {"symbol": "QQQ", "display_name": "Nasdaq 100 ETF", "asset_class": "Growth Equity"},
                    {"symbol": "TLT", "display_name": "20Y Treasury ETF", "asset_class": "Treasury"},
                    {"symbol": "GLD", "display_name": "Gold ETF", "asset_class": "Commodity"},
                ],
                "allocation_weight__SPY_pct": 35,
                "allocation_weight__QQQ_pct": 25,
                "allocation_weight__TLT_pct": 25,
                "allocation_weight__GLD_pct": 15,
                "investment_mode": "all_in",
                "rebalance_enabled": True,
                "rebalance_frequency": "quarterly",
                "rebalance_threshold_pct": 5,
                "cost_model_enabled": True,
                "fee_bps": 1.5,
                "slippage_bps": 2.5,
                "expense_ratio_bps": 8,
            },
        },
    )
    assert_ok(materialize_session(client, session["session_id"], idempotency_key="asset-allocation-progress-symbols"))

    symbols = service._canonical_progress_target_symbols(
        progress_target_symbols=[],
        existing_price_coverage=[],
        existing_corporate_coverage=[],
        existing_price_missing=[],
        existing_corporate_missing=[],
    )

    assert {"SPY", "QQQ", "TLT", "GLD"}.issubset(set(symbols))


def test_snapshot_provider_registry_does_not_import_openbb_when_disabled(tmp_path, monkeypatch):
    monkeypatch.delenv("GRIT_ENABLE_OPENBB_PROVIDER", raising=False)
    real_import = api_module.importlib.import_module
    imported_openbb_modules: list[str] = []

    def guarded_import(name, *args, **kwargs):
        if str(name).endswith(".openbb_provider"):
            imported_openbb_modules.append(str(name))
            raise AssertionError("OpenBB provider must not be imported while disabled")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(api_module.importlib, "import_module", guarded_import)
    client = TestClient(create_app(tmp_path / "openbb-disabled.db"))

    registry = assert_ok(client.get("/data-snapshots/provider-registry"))

    assert imported_openbb_modules == []
    assert registry["openbb_enabled"] is False
    assert all(not item["enabled"] for item in registry["items"] if item["provider_id"].startswith("openbb_"))


def test_snapshot_provider_registry_masks_openbb_environment_secrets(tmp_path, monkeypatch):
    monkeypatch.setenv("GRIT_ENABLE_OPENBB_PROVIDER", "1")
    monkeypatch.setenv("FMP_API_KEY", "super-secret-fmp-key")
    monkeypatch.setenv("TIINGO_API_TOKEN", "super-secret-tiingo-token")
    client = TestClient(create_app(tmp_path / "openbb-enabled.db"))

    response = client.get("/data-snapshots/provider-registry")
    registry = assert_ok(response)

    assert registry["openbb_enabled"] is True
    assert "super-secret" not in response.text
    openbb_index = next(item for item in registry["items"] if item["provider_id"] == "openbb_index_constituents")
    assert openbb_index["credential_requirements"]["configured"] is True
    assert openbb_index["credential_requirements"]["configured_env_vars"] == ["FMP_API_KEY"]
    assert openbb_index["pit_permission"]["can_upgrade_pit_readiness"] is False


def test_snapshot_overview_includes_bond_fixed_income_extension(tmp_path):
    client, _ = create_test_client(tmp_path)

    overview = assert_ok(client.get("/data-snapshots/overview"))
    bond = overview["bond_fixed_income"]

    assert {
        "global_pulse",
        "pillar_groups",
        "curve_preview",
        "audit_matrix",
        "raw_registry",
        "eligible_sources",
        "eligible_instruments",
        "scheduler",
        "selected_source_summary",
        "system_diagnostics",
    }.issubset(set(bond.keys()))
    assert bond["group_counts"] == {
        "ust": {"sourced": 0, "ready": 0},
        "tips": {"sourced": 0, "ready": 0},
        "ig": {"sourced": 0, "ready": 0},
    }
    assert bond["ust_10y_2y_spread_bps"] is None
    assert bond["tips_breakeven_pct"] is None
    assert bond["lqd_tracking_status"] is None
    assert bond["global_pulse"]["headline"]
    assert bond["curve_preview"] == []
    assert bond["raw_registry"] == []
    assert bond["eligible_sources"] == []
    assert bond["eligible_instruments"] == []
    assert bond["selected_source_summary"]["primary_source"] == "bond_fixed_income_snapshots"
    assert bond["selected_source_summary"]["fallback_source"] is None


def _seed_bond_contract_snapshot(client, **overrides: Any) -> str:
    base: dict[str, Any] = {
        "id": "bond-contract-base",
        "instrument_id": "BOND-CONTRACT-BASE",
        "symbol": "BOND",
        "name": "Bond contract fixture",
        "instrument_type": "bond",
        "currency": "USD",
        "snapshot_date": "2026-04-23",
        "maturity_date": "2031-04-23",
        "coupon_rate_pct": 4.0,
        "clean_price": 100.0,
        "net_price": 100.0,
        "dirty_price": 100.2,
        "full_price": 100.2,
        "accrued_interest": 0.2,
        "ytm_pct": 4.0,
        "duration": 5.0,
        "convexity": 0.5,
        "source": "bond_fixed_income",
        "refresh_status": "READY",
        "missing_fields": [],
        "inferred_fields": {},
        "raw": {},
    }
    base.update(overrides)
    return client.app.state.service.market_data_repository.upsert_bond_fixed_income_snapshot(base)


def _seed_seven_bond_contract_snapshots(client) -> dict[str, str]:
    rows = [
        {
            "id": "bond-ust-cmt-2y",
            "instrument_id": "UST_CMT_2Y",
            "symbol": "UST2Y",
            "name": "UST CMT 2Y",
            "ytm_pct": 1.0,
            "raw": {
                "asset_type": "UST",
                "tenor_label": "2Y",
                "audit_profile": "UST_CMT_2Y",
                "effective_duration": 1.9,
            },
        },
        {
            "id": "bond-ust-cmt-10y",
            "instrument_id": "UST_CMT_10Y",
            "symbol": "UST10Y",
            "name": "UST CMT 10Y",
            "ytm_pct": 4.65,
            "duration": 8.3,
            "raw": {
                "asset_type": "UST",
                "tenor_label": "10Y",
                "audit_profile": "UST_CMT_10Y",
                "effective_duration": 8.3,
            },
        },
        {
            "id": "bond-ust-cmt-30y",
            "instrument_id": "UST_CMT_30Y",
            "symbol": "UST30Y",
            "name": "UST CMT 30Y",
            "ytm_pct": 4.8,
            "duration": 17.8,
            "raw": {
                "asset_type": "UST",
                "tenor_label": "30Y",
                "audit_profile": "UST_CMT_30Y",
                "effective_duration": 17.8,
            },
        },
        {
            "id": "bond-ust-bill-13w",
            "instrument_id": "UST_BILL_3M",
            "symbol": "TBILL13W",
            "name": "UST T-Bill 13W",
            "instrument_type": "t_bill",
            "maturity_date": "2026-07-23",
            "coupon_rate_pct": 0.0,
            "accrued_interest": None,
            "ytm_pct": 5.21,
            "duration": 0.24,
            "missing_fields": ["accrued_interest"],
            "raw": {
                "asset_type": "T_BILL",
                "tenor_label": "13W",
                "audit_profile": "UST_BILL_3M",
                "discount_rate_pct": 5.18,
                "effective_duration": 0.24,
            },
        },
        {
            "id": "bond-tips-5y",
            "instrument_id": "TIPS_5Y",
            "symbol": "TIPS5Y",
            "name": "TIPS 5Y",
            "instrument_type": "tips",
            "ytm_pct": 3.94,
            "duration": 4.7,
            "raw": {
                "asset_type": "TIPS",
                "tenor_label": "5Y",
                "audit_profile": "TIPS",
                "real_yield_pct": 1.82,
                "inflation_factor": 1.0312,
                "breakeven_inflation_bps": 212.0,
                "effective_duration": 4.7,
            },
        },
        {
            "id": "bond-tips-10y",
            "instrument_id": "TIPS_10Y",
            "symbol": "TIPS10Y",
            "name": "TIPS 10Y",
            "instrument_type": "tips",
            "ytm_pct": 4.05,
            "duration": 7.9,
            "raw": {
                "asset_type": "TIPS",
                "tenor_label": "10Y",
                "audit_profile": "TIPS",
                "real_yield_pct": 2.03,
                "inflation_factor": 1.0425,
                "breakeven_inflation_bps": 262.0,
                "effective_duration": 7.9,
            },
        },
        {
            "id": "bond-lqd-watch",
            "instrument_id": "LQD",
            "symbol": "LQD",
            "name": "iShares iBoxx Investment Grade Corporate Bond ETF",
            "instrument_type": "etf",
            "refresh_status": "READY",
            "missing_fields": [],
            "raw": {
                "asset_type": "BOND_ETF",
                "tenor_label": "ETF",
                "audit_profile": "LQD",
                "sec_yield_30d_pct": 4.73,
                "credit_quality": "A-",
                "tracking_error_bps": 7.5,
                "audit_notes": ["Official tracking-error evidence pending."],
            },
        },
    ]
    return {row["id"]: _seed_bond_contract_snapshot(client, **row) for row in rows}


def test_bond_snapshot_overview_publishes_seven_row_contract_and_audit_cases(tmp_path):
    client, _ = create_test_client(tmp_path)
    snapshot_refs = _seed_seven_bond_contract_snapshots(client)

    overview = assert_ok(client.get("/data-snapshots/overview"))
    bond = overview["bond_fixed_income"]
    instruments = {item["id"]: item for item in bond["eligible_instruments"]}

    assert len(bond["raw_registry"]) == 7
    assert len(instruments) == 7
    assert set(instruments) == set(snapshot_refs)
    assert bond["group_counts"]["ust"]["sourced"] == 4
    assert bond["group_counts"]["tips"]["sourced"] == 2
    assert bond["group_counts"]["ig"]["sourced"] == 1
    assert bond["ust_10y_2y_spread_bps"] == 365.0
    assert bond["tips_real_yield_pct"] == 2.03
    assert bond["tips_inflation_factor"] == 1.0425
    assert bond["tips_breakeven_pct"] == 2.62
    assert bond["lqd_sec_yield_30d_pct"] == 4.73
    assert bond["lqd_credit_quality"] == "A-"
    assert bond["lqd_tracking_status"] == "WATCH"

    bill = instruments["bond-ust-bill-13w"]
    assert bill["asset_type"] == "T_BILL"
    assert bill["tenor_label"] == "13W"
    assert bill["audit_profile"] == "UST_BILL_3M"
    assert bill["discount_rate_pct"] == 5.18
    assert bill["accrued_interest"] is None
    assert bill["field_status"]["accrued_interest"] == "WAIVED"
    assert bill["status"] == "READY"

    tips = instruments["bond-tips-10y"]
    assert tips["asset_type"] == "TIPS"
    assert tips["tenor_label"] == "10Y"
    assert tips["real_yield_pct"] == 2.03
    assert tips["inflation_factor"] == 1.0425
    assert tips["breakeven_inflation_bps"] == 262.0
    assert tips["effective_duration"] == 7.9

    ust_10y = instruments["bond-ust-cmt-10y"]
    assert ust_10y["asset_type"] == "UST"
    assert ust_10y["tenor_label"] == "10Y"
    assert ust_10y["tracking_status"] is None
    assert ust_10y["status"] == "WATCH"
    assert any("UST_CMT_2Y/10Y spread 365 bps" in alert for alert in ust_10y["audit_alerts"])

    lqd = instruments["bond-lqd-watch"]
    assert lqd["asset_type"] == "BOND_ETF"
    assert lqd["sec_yield_30d_pct"] == 4.73
    assert lqd["credit_quality"] == "A-"
    assert lqd["tracking_error_bps"] == 7.5
    assert lqd["field_status"]["tracking_error_bps"] == "MISSING"
    assert lqd["tracking_status"] == "WATCH"
    assert lqd["status"] == "WATCH"


def test_bond_snapshot_overview_reaches_full_ready_when_lqd_tracking_source_is_published(tmp_path):
    client, _ = create_test_client(tmp_path)
    _seed_seven_bond_contract_snapshots(client)
    _seed_bond_contract_snapshot(
        client,
        id="bond-ust-cmt-2y",
        instrument_id="UST_CMT_2Y",
        symbol="UST2Y",
        name="UST CMT 2Y",
        ytm_pct=4.4,
        raw={
            "asset_type": "UST",
            "tenor_label": "2Y",
            "audit_profile": "UST_CMT_2Y",
            "effective_duration": 1.9,
        },
    )
    _seed_bond_contract_snapshot(
        client,
        id="bond-lqd-watch",
        instrument_id="LQD",
        symbol="LQD",
        name="iShares iBoxx Investment Grade Corporate Bond ETF",
        instrument_type="etf",
        refresh_status="READY",
        missing_fields=[],
        raw={
            "asset_type": "BOND_ETF",
            "tenor_label": "ETF",
            "audit_profile": "LQD",
            "sec_yield_30d_pct": 4.73,
            "credit_quality": "A-",
            "tracking_error_bps": 164.0,
            "tracking_error_source": "MARKETS_INSIDER",
            "tracking_error_period": "1Y",
            "audit_notes": ["Tracking error sourced from a published market-data page."],
        },
    )
    _seed_bond_contract_snapshot(
        client,
        id="bond-lqd-old-watch",
        instrument_id="LQD",
        symbol="LQD",
        name="Old LQD watch row",
        instrument_type="etf",
        snapshot_date="2026-04-01",
        refresh_status="WATCH",
        missing_fields=["tracking_error_bps"],
        raw={
            "asset_type": "BOND_ETF",
            "tenor_label": "ETF",
            "audit_profile": "LQD",
            "sec_yield_30d_pct": 4.6,
            "credit_quality": "A-",
        },
    )
    _seed_bond_contract_snapshot(
        client,
        id="bond-extra-smoke-row",
        instrument_id="US91282CGK18",
        symbol="T10Y",
        name="Extra manually loaded note",
        snapshot_date="2026-04-24",
        refresh_status="READY",
        raw={"asset_type": "INDIVIDUAL_BOND"},
    )

    overview = assert_ok(client.get("/data-snapshots/overview"))
    bond = overview["bond_fixed_income"]
    instruments = {item["id"]: item for item in bond["eligible_instruments"]}

    assert len(bond["raw_registry"]) == 7
    assert bond["group_counts"] == {
        "ust": {"sourced": 4, "ready": 4},
        "tips": {"sourced": 2, "ready": 2},
        "ig": {"sourced": 1, "ready": 1},
    }
    assert bond["global_pulse"]["status"] == "READY"
    assert bond["global_pulse"]["cards"][1]["status"] == "READY"
    assert bond["global_pulse"]["cards"][1]["value"] == "7/7 ready"
    assert bond["global_pulse"]["cards"][4]["value"] == "7/7 eligible"
    assert bond["global_pulse"]["cards"][8]["status"] == "READY"
    assert bond["lqd_tracking_status"] == "READY"
    assert instruments["bond-lqd-watch"]["field_status"]["tracking_error_bps"] == "READY"
    assert instruments["bond-lqd-watch"]["tracking_error_source"] == "MARKETS_INSIDER"
    assert instruments["bond-lqd-watch"]["status"] == "READY"


def test_refresh_target_pool_filters_non_ticker_labels_from_missing_symbols_and_strategies(tmp_path):
    service = RealBacktestPlatformService(tmp_path / "snapshot-symbol-filter.db", market_data_provider=None)
    service.list_strategies = lambda: [  # type: ignore[method-assign]
        {"universe_name": "标普500成分股", "benchmark_symbol": "QQQ", "strategy_type": "MOMENTUM"},
        {"universe_name": "BRK-B", "benchmark_symbol": "SPY", "strategy_type": "GRID"},
    ]

    filtered_missing = service._snapshot_missing_symbols(  # type: ignore[attr-defined]
        {"metadata": {"missing_symbols": ["AAPL", "标普500成分股", "BRK-B", ""]}}
    )

    assert filtered_missing == ["AAPL", "BRK-B"]
    assert "标普500成分股" not in service._all_refresh_symbols()  # type: ignore[attr-defined]
    assert "BRK-B" in service._all_refresh_symbols()  # type: ignore[attr-defined]


def test_snapshot_missing_symbols_excludes_symbols_with_persisted_coverage(tmp_path):
    service = RealBacktestPlatformService(tmp_path / "snapshot-covered-missing.db", market_data_provider=None)
    service.market_data_repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "?∠巨隞瑟?唳",
            "status": "INCOMPLETE",
            "as_of": "2026-04-16T00:00:00Z",
            "freshness_label": "敺耨憭?",
            "start_date": "1996-01-01",
            "end_date": "2026-04-15",
            "row_count": 1,
            "source": "yahoo",
            "fallback_source": None,
            "blocker": {"code": "PRICE_SNAPSHOT_INCOMPLETE", "message": "waiting"},
            "metadata": {"missing_symbols": ["AAPL", "MSFT"]},
        },
        price_bars=[
            {
                "symbol": "AAPL",
                "date": "2026-04-15",
                "open": 100.0,
                "high": 101.0,
                "low": 99.0,
                "close": 100.5,
                "adj_close": 100.5,
                "volume": 1000,
                "source": "yahoo",
                "fallback_source": None,
            }
        ],
        symbol_coverage=[CoverageSummary(symbol="AAPL", start_date="2026-04-15", end_date="2026-04-15", trade_days=1)],
    )

    filtered_missing = service._snapshot_missing_symbols(  # type: ignore[attr-defined]
        next(item for item in service.market_data_repository.list_dataset_snapshots() if item["id"] == "ds-price")
    )

    assert filtered_missing == ["MSFT"]


def test_scoped_market_data_provider_excludes_longbridge_for_full_history(tmp_path):
    class _NamedProvider:
        def __init__(self, provider_name: str) -> None:
            self.provider_name = provider_name

    class _FakeRuntimeProvider:
        provider_name = "runtime"

        def __init__(self, providers: list[_NamedProvider], captured: list[set[str]] | None = None) -> None:
            self.providers = list(providers)
            self.missing_providers: list[str] = []
            self.universe_history_providers: list[object] = []
            self.captured = captured if captured is not None else []

        def scoped_copy(self, *, exclude_provider_names=None):
            excluded = {str(item) for item in (exclude_provider_names or [])}
            self.captured.append(excluded)
            return _FakeRuntimeProvider(
                [provider for provider in self.providers if provider.provider_name not in excluded],
                captured=self.captured,
            )

    runtime_provider = _FakeRuntimeProvider(
        [
            _NamedProvider("yahoo"),
            _NamedProvider("tiingo"),
            _NamedProvider("longbridge_static_info"),
            _NamedProvider("longbridge"),
            _NamedProvider("akshare_us"),
        ]
    )
    service = RealBacktestPlatformService(tmp_path / "scoped-full.db", market_data_provider=runtime_provider)

    scoped = service._scoped_market_data_provider(mode="full", window_start=date(1996, 1, 1))

    assert runtime_provider.captured == [{"longbridge", "longbridge_static_info", "futu", "futu_rehab", "tiingo"}]
    assert [provider.provider_name for provider in scoped.providers] == ["yahoo", "akshare_us"]


def test_scoped_market_data_provider_excludes_openbb_quota_sources_outside_repair(tmp_path, monkeypatch):
    monkeypatch.delenv("GRIT_ENABLE_PAID_OPTIONAL_PROVIDERS", raising=False)

    class _NamedProvider:
        def __init__(self, provider_name: str) -> None:
            self.provider_name = provider_name

    class _FakeRuntimeProvider:
        provider_name = "runtime"

        def __init__(self, providers: list[_NamedProvider], captured: list[set[str]] | None = None) -> None:
            self.providers = list(providers)
            self.missing_providers: list[str] = []
            self.universe_history_providers: list[object] = []
            self.captured = captured if captured is not None else []

        def scoped_copy(self, *, exclude_provider_names=None):
            excluded = {str(item) for item in (exclude_provider_names or [])}
            self.captured.append(excluded)
            return _FakeRuntimeProvider(
                [provider for provider in self.providers if provider.provider_name not in excluded],
                captured=self.captured,
            )

    runtime_provider = _FakeRuntimeProvider(
        [
            _NamedProvider("yahoo"),
            _NamedProvider("openbb_yfinance"),
            _NamedProvider("openbb_tiingo"),
            _NamedProvider("openbb_alpha_vantage"),
            _NamedProvider("openbb_fmp"),
        ]
    )
    service = RealBacktestPlatformService(tmp_path / "scoped-openbb.db", market_data_provider=runtime_provider)

    scoped = service._scoped_market_data_provider(mode="full", window_start=date(1996, 1, 1))

    assert runtime_provider.captured == [
        {
            "longbridge",
            "longbridge_static_info",
            "futu",
            "futu_rehab",
            "tiingo",
            "openbb_tiingo",
            "openbb_alpha_vantage",
            "openbb_fmp",
        }
    ]
    assert [provider.provider_name for provider in scoped.providers] == ["yahoo", "openbb_yfinance"]


def test_scoped_market_data_provider_keeps_longbridge_for_recent_incremental_window(tmp_path):
    class _NamedProvider:
        def __init__(self, provider_name: str) -> None:
            self.provider_name = provider_name

    class _FakeRuntimeProvider:
        provider_name = "runtime"

        def __init__(self, providers: list[_NamedProvider]) -> None:
            self.providers = list(providers)
            self.missing_providers: list[str] = []
            self.universe_history_providers: list[object] = []
            self.scoped_calls = 0

        def scoped_copy(self, *, exclude_provider_names=None):
            self.scoped_calls += 1
            return self

    runtime_provider = _FakeRuntimeProvider(
        [_NamedProvider("yahoo"), _NamedProvider("tiingo"), _NamedProvider("longbridge")]
    )
    service = RealBacktestPlatformService(tmp_path / "scoped-incremental.db", market_data_provider=runtime_provider)

    scoped = service._scoped_market_data_provider(mode="incremental", window_start=date(2026, 4, 1))

    assert scoped is runtime_provider
    assert runtime_provider.scoped_calls == 1


def test_scoped_market_data_provider_excludes_stooq_for_incremental_window(tmp_path):
    class _NamedProvider:
        def __init__(self, provider_name: str) -> None:
            self.provider_name = provider_name

    class _FakeRuntimeProvider:
        provider_name = "runtime"

        def __init__(self, providers: list[_NamedProvider], captured: list[set[str]] | None = None) -> None:
            self.providers = list(providers)
            self.missing_providers: list[str] = []
            self.universe_history_providers: list[object] = []
            self.captured = captured if captured is not None else []

        def scoped_copy(self, *, exclude_provider_names=None, allow_targeted_price_repair=None):
            excluded = {str(item) for item in (exclude_provider_names or [])}
            self.captured.append(excluded)
            return _FakeRuntimeProvider(
                [provider for provider in self.providers if provider.provider_name not in excluded],
                captured=self.captured,
            )

    runtime_provider = _FakeRuntimeProvider(
        [_NamedProvider("yahoo"), _NamedProvider("stooq"), _NamedProvider("longbridge")]
    )
    service = RealBacktestPlatformService(tmp_path / "scoped-incremental-stooq.db", market_data_provider=runtime_provider)

    scoped = service._scoped_market_data_provider(mode="incremental", window_start=date(2026, 4, 1))

    assert runtime_provider.captured == [{"stooq", "tiingo", "longbridge"}]
    assert [provider.provider_name for provider in scoped.providers] == ["yahoo"]


def test_scoped_market_data_provider_enables_targeted_price_repair_only_when_requested(tmp_path):
    class _NamedProvider:
        def __init__(self, provider_name: str) -> None:
            self.provider_name = provider_name

    class _FakeRuntimeProvider:
        provider_name = "runtime"

        def __init__(self, providers: list[_NamedProvider], captured: list[dict[str, object]] | None = None) -> None:
            self.providers = list(providers)
            self.missing_providers: list[str] = []
            self.universe_history_providers: list[object] = []
            self.captured = captured if captured is not None else []

        def scoped_copy(self, *, exclude_provider_names=None, allow_targeted_price_repair=None):
            self.captured.append(
                {
                    "excluded": {str(item) for item in (exclude_provider_names or [])},
                    "allow_targeted_price_repair": bool(allow_targeted_price_repair),
                }
            )
            return _FakeRuntimeProvider(self.providers, captured=self.captured)

    runtime_provider = _FakeRuntimeProvider(
        [_NamedProvider("yahoo"), _NamedProvider("yfinance"), _NamedProvider("alpha_vantage")]
    )
    service = RealBacktestPlatformService(tmp_path / "scoped-targeted-repair.db", market_data_provider=runtime_provider)

    scoped = service._scoped_market_data_provider(
        mode="repair",
        window_start=date(2026, 4, 1),
        allow_targeted_price_repair=True,
    )

    assert runtime_provider.captured == [
        {"excluded": set(), "allow_targeted_price_repair": True}
    ]
    assert scoped is not runtime_provider


def test_scoped_market_data_provider_keeps_polygon_available_for_targeted_price_repair(tmp_path, monkeypatch):
    monkeypatch.delenv("GRIT_ENABLE_PAID_OPTIONAL_PROVIDERS", raising=False)

    class _NamedProvider:
        def __init__(self, provider_name: str) -> None:
            self.provider_name = provider_name

    class _FakeRuntimeProvider:
        provider_name = "runtime"

        def __init__(self, providers: list[_NamedProvider], captured: list[dict[str, object]] | None = None) -> None:
            self.providers = list(providers)
            self.missing_providers: list[str] = []
            self.universe_history_providers: list[object] = []
            self.captured = captured if captured is not None else []

        def scoped_copy(self, *, exclude_provider_names=None, allow_targeted_price_repair=None):
            excluded = {str(item) for item in (exclude_provider_names or [])}
            self.captured.append(
                {
                    "excluded": excluded,
                    "allow_targeted_price_repair": bool(allow_targeted_price_repair),
                }
            )
            return _FakeRuntimeProvider(
                [provider for provider in self.providers if provider.provider_name not in excluded],
                captured=self.captured,
            )

    runtime_provider = _FakeRuntimeProvider(
        [_NamedProvider("yfinance"), _NamedProvider("polygon")]
    )
    service = RealBacktestPlatformService(tmp_path / "scoped-targeted-repair-polygon.db", market_data_provider=runtime_provider)

    scoped = service._scoped_market_data_provider(
        mode="repair",
        window_start=date(2026, 4, 1),
        allow_targeted_price_repair=True,
    )

    assert runtime_provider.captured == [
        {"excluded": set(), "allow_targeted_price_repair": True}
    ]
    assert [provider.provider_name for provider in scoped.providers] == ["yfinance", "polygon"]


def test_start_snapshot_refresh_subprocess_preserves_repair_symbol_limit(tmp_path, monkeypatch):
    service = RealBacktestPlatformService(tmp_path / "snapshot-refresh-subprocess.db", market_data_provider=None)
    captured: dict[str, Any] = {}

    class _DummyProcess:
        pid = 4321

    def fake_popen(command, cwd=None, env=None, creationflags=0):
        captured["command"] = list(command)
        captured["cwd"] = cwd
        captured["env"] = dict(env or {})
        captured["creationflags"] = creationflags
        return _DummyProcess()

    monkeypatch.setattr(real_service_module.subprocess, "Popen", fake_popen)

    service._start_snapshot_refresh_subprocess(
        job={
            "id": "snap_repair_limit",
            "created_at": "2026-05-13T00:00:00Z",
            "started_at": "2026-05-13T00:00:01Z",
        },
        payload={
            "reason": "repair-limit-check",
            "mode": "repair",
            "targets": ["price"],
            "repair_symbol_limit": 174,
        },
        mode="repair",
        targets=["price"],
    )

    assert captured["command"][-2:] == ["--repair-symbol-limit", "174"]
    assert "refresh-snapshots" in captured["command"]
    assert service._snapshot_refresh_process.pid == 4321


def test_snapshot_refresh_heartbeat_persists_runtime_stage_and_refresh_stats(tmp_path):
    service = RealBacktestPlatformService(tmp_path / "snapshot-heartbeat.db", market_data_provider=None)

    persisted_job = service._persist_snapshot_refresh_heartbeat(
        job_id="snap_heartbeat",
        request={"reason": "unit-test"},
        mode="repair",
        targets=["price", "corporate"],
        created_at="2026-04-13T07:00:00Z",
        started_at="2026-04-13T07:00:00Z",
        symbol_count=3,
        row_count=30,
        warnings=["warn-1"],
        errors=[],
        current_stage="repair_market_data",
        current_stage_label="正在修复历史缺口数据",
        progress={"completed_symbols": 3, "total_symbols": 12},
        heartbeat_at="2026-04-13T07:01:00Z",
        refresh_stats={
            "datasets": {
                "ds-price": {"updated_symbol_count": 3, "updated_row_count": 30},
            },
            "universes": {},
        },
    )

    assert persisted_job["status"] == "RUNNING"
    stored_row = service.storage.fetch_one("SELECT * FROM snapshot_refresh_jobs WHERE id = ?", ("snap_heartbeat",))
    decoded_job = service._decode_snapshot_refresh_job(stored_row)
    runtime_state = service._load_snapshot_refresh_runtime_state()
    runtime_row = service.storage.fetch_one(
        "SELECT updated_at FROM app_runtime_state WHERE state_key = ?",
        ("snapshot_refresh_runtime",),
    )

    assert decoded_job is not None
    assert runtime_row is not None
    assert runtime_row["updated_at"] == "2026-04-13T07:01:00Z"
    assert decoded_job["summary"]["current_stage"] == "repair_market_data"
    assert decoded_job["summary"]["current_stage_label"] == "正在修复历史缺口数据"
    assert decoded_job["summary"]["heartbeat_at"] == "2026-04-13T07:01:00Z"
    assert decoded_job["summary"]["progress"] == {"completed_symbols": 3, "total_symbols": 12}
    assert decoded_job["summary"]["refresh_stats"]["datasets"]["ds-price"]["updated_row_count"] == 30
    assert runtime_state == {
        "job_id": "snap_heartbeat",
        "mode": "repair",
        "targets": ["price", "corporate"],
        "pid": os.getpid(),
        "current_stage": "repair_market_data",
        "current_stage_label": "正在修复历史缺口数据",
        "progress": {"completed_symbols": 3, "total_symbols": 12},
        "heartbeat_at": "2026-04-13T07:01:00Z",
    }


def test_snapshot_refresh_persists_provider_summary_for_each_snapshot_pool(tmp_path):
    class _Provider:
        provider_name = "runtime"

        def fetch_history(self, symbol, start_date, end_date):
            return {
                "source": "yahoo",
                "fallback_source": "mixed_fallbacks",
                "bars": [
                    {
                        "date": "2026-04-10",
                        "open": 190.0,
                        "high": 191.0,
                        "low": 189.0,
                        "close": 190.5,
                        "adj_close": 190.5,
                        "volume": 1000,
                    }
                ],
                "actions": [
                    {
                        "date": "2026-04-10",
                        "action_type": "dividend",
                        "value": 1.0,
                        "source": "alpha_vantage",
                        "payload": {"cash": 1.0},
                    }
                ],
                "warnings": [],
                "partial": True,
                "metadata": {
                        "provider_results": [
                            {
                                "provider": "yahoo",
                                "kind": "history",
                                "status": "succeeded",
                                "source": "yahoo",
                                "bar_count": 1,
                                "action_count": 0,
                                "partial": False,
                                "selection_status": "selected_primary",
                                "actions_supported": True,
                                "access_tier": "public",
                                "probe_complete": True,
                                "quota_limited": False,
                            },
                            {
                                "provider": "tiingo",
                                "kind": "history",
                                "status": "succeeded",
                                "source": "tiingo",
                                "bar_count": 1,
                                "action_count": 1,
                                "partial": False,
                                "selection_status": "succeeded_not_selected",
                                "actions_supported": True,
                                "access_tier": "free_account",
                                "probe_complete": True,
                                "quota_limited": False,
                            },
                            {
                                "provider": "akshare_us",
                                "kind": "history",
                                "status": "skipped",
                                "source": "akshare_us",
                                "bar_count": 0,
                                "action_count": 0,
                                "partial": False,
                                "reason": "primary_price_source_already_selected",
                                "actions_supported": False,
                                "access_tier": "public",
                            },
                            {
                                "provider": "longbridge",
                                "kind": "history",
                                "status": "limited",
                                "source": "longbridge",
                                "bar_count": 0,
                                "action_count": 0,
                                "partial": False,
                                "reason": "provider quota cooldown",
                                "actions_supported": False,
                                "access_tier": "paid_optional",
                                "quota_limited": True,
                                "next_retry_at": "2026-04-10T12:00:00Z",
                            },
                            {
                                "provider": "alpha_vantage",
                                "kind": "earnings",
                                "status": "succeeded",
                                "source": "alpha_vantage",
                                "bar_count": 0,
                                "action_count": 1,
                                "partial": False,
                                "actions_supported": True,
                                "access_tier": "free_account",
                                "probe_complete": False,
                                "quota_limited": False,
                            },
                            {
                                "provider": "sec_edgar",
                                "kind": "filings_availability",
                                "status": "unavailable",
                                "source": "sec_edgar",
                                "bar_count": 0,
                                "action_count": 0,
                                "partial": False,
                                "reason": "SEC_USER_AGENT must include a contact email.",
                                "actions_supported": True,
                                "access_tier": "free_account",
                            },
                        ],
                    "provider_chain": ["yahoo", "tiingo", "akshare_us", "alpha_vantage", "sec_edgar"],
                    "missing_provider_reasons": {
                        "sec_edgar": "SEC_USER_AGENT must include a contact email.",
                    },
                },
            }

    class _UniverseProvider:
        provider_name = "fmp_historical_constituent"

        def load_snapshots(self, start_date: date, end_date: date):
            return [
                UniverseMembershipSnapshot(
                    universe_key=SP500_UNIVERSE_KEY,
                    universe_name=SP500_UNIVERSE_NAME,
                    effective_date=date(2026, 1, 1),
                    normalized_symbols=["AAPL", "MSFT"],
                    raw_symbols=["AAPL", "MSFT"],
                    unmapped_symbols=[],
                    source="wikipedia_revision_history",
                    fallback_source=None,
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="wiki-sp500-2026-01-01",
                    source_page_title=SP500_SOURCE_PAGE_TITLE,
                    metadata={
                        "coverage_mode": "point_in_time_anchor",
                        "source_quality": "historical_revision_snapshot",
                        "historical_constituent_provider": "fmp",
                        "historical_constituent_probe_status": "capability_unavailable",
                        "historical_constituent_probe_error": "FMP_API_KEY is not configured.",
                    },
                ),
                UniverseMembershipSnapshot(
                    universe_key=NASDAQ100_UNIVERSE_KEY,
                    universe_name=NASDAQ100_UNIVERSE_NAME,
                    effective_date=date(2026, 1, 1),
                    normalized_symbols=["AAPL", "MSFT"],
                    raw_symbols=["AAPL", "MSFT"],
                    unmapped_symbols=[],
                    source="wikipedia_revision_history",
                    fallback_source=None,
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="wiki-ndx100-2026-01-01",
                    source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
                    metadata={
                        "coverage_mode": "point_in_time_anchor",
                        "source_quality": "historical_revision_snapshot",
                        "historical_constituent_provider": "fmp",
                        "historical_constituent_probe_status": "capability_unavailable",
                        "historical_constituent_probe_error": "FMP_API_KEY is not configured.",
                    },
                ),
            ]

    service = RealBacktestPlatformService(tmp_path / "provider-summary.db", market_data_provider=_Provider())
    service._universe_history_providers = lambda: [_UniverseProvider()]  # type: ignore[method-assign]

    overview = service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    refresh_stats = overview["latest_job"]["summary"]["refresh_stats"]

    price_summary = refresh_stats["datasets"]["ds-price"]["provider_summary"]
    corporate_summary = refresh_stats["datasets"]["ds-corporate-actions"]["provider_summary"]
    sp500_summary = refresh_stats["universes"]["un-sp500"]["provider_summary"]

    assert price_summary["providers"]["yahoo"]["landed_row_count"] >= 1
    assert price_summary["providers"]["yahoo"]["selected_primary_symbols"] >= 1
    assert price_summary["providers"]["yahoo"]["actions_supported"] is True
    assert price_summary["providers"]["yahoo"]["access_tier"] == "public"
    assert price_summary["providers"]["yahoo"]["probe_complete"] is True
    assert price_summary["providers"]["yahoo"]["quota_limited"] is False
    assert price_summary["providers"]["yahoo"]["next_retry_at"] is None
    assert price_summary["providers"]["tiingo"]["succeeded_not_selected_symbols"] >= 1
    assert price_summary["providers"]["tiingo"]["access_tier"] == "free_account"
    assert price_summary["providers"]["longbridge"]["quota_limited"] is True
    assert price_summary["providers"]["longbridge"]["next_retry_at"] == "2026-04-10T12:00:00Z"
    assert "akshare_us" in price_summary["skipped_providers"]
    assert "sec_edgar" not in price_summary["providers"]
    assert "sec_edgar" in corporate_summary["unavailable_providers"]
    assert "SEC_USER_AGENT must include a contact email." in corporate_summary["providers"]["sec_edgar"]["reasons"]
    assert corporate_summary["providers"]["alpha_vantage"]["landed_row_count"] >= 1
    assert corporate_summary["providers"]["alpha_vantage"]["actions_supported"] is True
    assert corporate_summary["providers"]["alpha_vantage"]["access_tier"] == "free_account"
    assert corporate_summary["providers"]["alpha_vantage"]["probe_complete"] is False
    assert corporate_summary["providers"]["alpha_vantage"]["quota_limited"] is False
    assert "alpha_vantage" in corporate_summary["attempted_providers"]
    assert sp500_summary["providers"]["wikipedia_revision_history"]["landed_anchor_count"] == 1
    assert "fmp" in sp500_summary["skipped_providers"]
    assert sp500_summary["providers"]["fmp"]["reasons"] == ["FMP_API_KEY is not configured."]

    readiness_summary = overview["provider_readiness_summary"]
    assert readiness_summary["registered_provider_count"] == readiness_summary["provider_count"]
    assert readiness_summary["credential_ready_provider_count"] >= 1
    assert readiness_summary["usable_provider_count"] >= 1
    assert readiness_summary["attempt_event_count"] >= readiness_summary["unique_attempted_provider_count"]
    assert readiness_summary["latest_job_attempt_event_count"] >= readiness_summary["latest_job_attempted_provider_count"]
    assert readiness_summary["attempt_rollup_policy"] == "unique_provider_latest_job_priority"
    assert "credential_ready_provider_count" in readiness_summary["openbb"]
    assert "usable_provider_count" in readiness_summary["openbb"]
    assert "latest_job_attempt_event_count" in readiness_summary["openbb"]
    assert readiness_summary["quota_limited_provider_count"] >= 1
    assert readiness_summary["cooldown_provider_count"] >= 1
    assert readiness_summary["target_type_counts"]["price_history"] >= 1

    all_attempts = service.get_snapshot_provider_attempts()
    assert all_attempts["rollup"]["policy"] == "unique_provider_latest_job_priority"
    assert all_attempts["rollup"]["event_count"] == len(all_attempts["items"])
    assert all_attempts["rollup"]["unique_provider_count"] <= all_attempts["rollup"]["event_count"]
    assert all_attempts["rollup"]["latest_job_event_count"] >= all_attempts["rollup"]["latest_job_unique_provider_count"]
    assert any(
        provider["selected_from"] == "latest_job"
        for provider in all_attempts["rollup"]["providers"]
        if provider["latest_job_event_count"]
    )

    attempts = service.get_snapshot_provider_attempts(provider_id="longbridge")
    assert attempts["latest_job_id"] == overview["latest_job"]["id"]
    assert attempts["rollup"]["unique_provider_count"] == 1
    assert attempts["rollup"]["providers"][0]["selected_from"] == "latest_job"
    longbridge_attempt = attempts["items"][0]
    assert longbridge_attempt["provider_id"] == "longbridge"
    assert longbridge_attempt["target_type"] == "price_history"
    assert longbridge_attempt["status"] == "limited"
    assert longbridge_attempt["quota_limited"] is True
    assert longbridge_attempt["cooldown_active"] is True
    assert longbridge_attempt["pit_effect"]["can_upgrade_pit_readiness"] is True

    registry = service.get_snapshot_provider_registry()
    longbridge_registry = next(item for item in registry["items"] if item["provider_id"] == "longbridge")
    assert longbridge_registry["latest_attempt"]["status"] == "limited"
    assert longbridge_registry["quota_cooldown"]["next_retry_at"] == "2026-04-10T12:00:00Z"
    assert longbridge_registry["credential_ready"] is True
    assert longbridge_registry["usable"] is False
    if longbridge_registry["enabled"]:
        assert longbridge_registry["readiness_status"] == "cooldown"
    else:
        assert longbridge_registry["readiness_status"] == "disabled"


def test_openbb_current_constituent_check_does_not_flip_universe_readiness(tmp_path):
    class _CurrentUniverseChecker:
        provider_name = "openbb_index_constituents"

        def check_current_constituents(self, *, universe_key, universe_name, symbols):
            return {
                "provider": self.provider_name,
                "status": "succeeded",
                "current_member_count": len(symbols),
                "anchor_member_count": len(symbols),
                "matched_latest_anchor_count": len(symbols),
                "auxiliary_only": True,
            }

    class _RuntimeProvider:
        provider_name = "runtime"

        def __init__(self) -> None:
            self.universe_history_providers = [_UniverseProvider()]
            self.current_universe_constituent_checker = _CurrentUniverseChecker()

    class _UniverseProvider:
        provider_name = "wikipedia_revision_history"

        def load_snapshots(self, start_date: date, end_date: date):
            return [
                UniverseMembershipSnapshot(
                    universe_key=SP500_UNIVERSE_KEY,
                    universe_name=SP500_UNIVERSE_NAME,
                    effective_date=date(2026, 1, 1),
                    normalized_symbols=["AAPL", "MSFT"],
                    raw_symbols=["AAPL", "MSFT"],
                    unmapped_symbols=[],
                    source="wikipedia_current_page",
                    fallback_source="wikipedia_revision_history",
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="current-sp500-2026-01-01",
                    source_page_title=SP500_SOURCE_PAGE_TITLE,
                    metadata={"source_quality": "current_page_fallback"},
                ),
                UniverseMembershipSnapshot(
                    universe_key=NASDAQ100_UNIVERSE_KEY,
                    universe_name=NASDAQ100_UNIVERSE_NAME,
                    effective_date=date(2026, 1, 1),
                    normalized_symbols=["AAPL", "MSFT"],
                    raw_symbols=["AAPL", "MSFT"],
                    unmapped_symbols=[],
                    source="wikipedia_current_page",
                    fallback_source="wikipedia_revision_history",
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="current-ndx100-2026-01-01",
                    source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
                    metadata={"source_quality": "current_page_fallback"},
                ),
            ]

    service = RealBacktestPlatformService(tmp_path / "openbb-universe-auxiliary.db", market_data_provider=_RuntimeProvider())

    overview = service.refresh_snapshots({"mode": "repair", "targets": ["universes"]})
    sp500_snapshot = next(item for item in overview["universe_snapshots"] if item["id"] == SP500_UNIVERSE_SNAPSHOT_ID)
    sp500_summary = overview["latest_job"]["summary"]["refresh_stats"]["universes"][SP500_UNIVERSE_SNAPSHOT_ID]["provider_summary"]

    assert sp500_snapshot["status"] == "INCOMPLETE"
    assert sp500_snapshot["metadata"]["historical_anchor_count"] == 0
    assert sp500_snapshot["metadata"]["openbb_current_constituent_check"]["auxiliary_only"] is True
    assert sp500_summary["providers"]["openbb_index_constituents"]["auxiliary_only"] is True
    assert sp500_summary["providers"]["openbb_index_constituents"]["landed_anchor_count"] == 0

    attempts = service.get_snapshot_provider_attempts(provider_id="openbb_index_constituents")
    assert attempts["items"]
    assert attempts["items"][0]["auxiliary_only"] is True
    assert attempts["items"][0]["pit_effect"]["mode"] == "metadata_only"
    assert attempts["items"][0]["pit_effect"]["can_upgrade_pit_readiness"] is False
    registry = service.get_snapshot_provider_registry()
    openbb_index = next(item for item in registry["items"] if item["provider_id"] == "openbb_index_constituents")
    assert openbb_index["pit_permission"]["mode"] == "metadata_only"
    assert openbb_index["pit_permission"]["can_upgrade_pit_readiness"] is False


def test_snapshot_refresh_marks_zero_event_action_probe_as_corporate_covered(tmp_path):
    class _Provider:
        provider_name = "runtime"

        def fetch_history(self, symbol, start_date, end_date):
            return {
                "source": "yahoo",
                "fallback_source": None,
                "bars": [
                    {
                        "date": "2026-04-10",
                        "open": 190.0,
                        "high": 191.0,
                        "low": 189.0,
                        "close": 190.5,
                        "adj_close": 190.5,
                        "volume": 1000,
                    }
                ],
                "actions": [
                    {
                        "date": "2026-04-10",
                        "action_type": "earnings_report",
                        "value": 1.0,
                        "source": "alpha_vantage",
                        "payload": {"reported_eps": 1.0},
                    }
                ],
                "warnings": [],
                "partial": False,
                "metadata": {
                    "provider_results": [
                        {
                            "provider": "yahoo",
                            "kind": "history",
                            "status": "succeeded",
                            "source": "yahoo",
                            "bar_count": 1,
                            "action_count": 0,
                            "partial": False,
                            "selection_status": "selected_primary",
                            "actions_supported": True,
                        },
                        {
                            "provider": "alpha_vantage",
                            "kind": "earnings",
                            "status": "succeeded",
                            "source": "alpha_vantage",
                            "bar_count": 0,
                            "action_count": 1,
                            "partial": False,
                        },
                    ],
                },
            }

    class _UniverseProvider:
        provider_name = "test_universe"

        def load_snapshots(self, start_date: date, end_date: date):
            return [
                UniverseMembershipSnapshot(
                    universe_key=SP500_UNIVERSE_KEY,
                    universe_name=SP500_UNIVERSE_NAME,
                    effective_date=date(2026, 1, 1),
                    normalized_symbols=["AAPL"],
                    raw_symbols=["AAPL"],
                    unmapped_symbols=[],
                    source="static_seed",
                    fallback_source=None,
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="sp500-2026-01-01",
                    source_page_title=SP500_SOURCE_PAGE_TITLE,
                    metadata={"coverage_mode": "point_in_time_anchor", "source_quality": "historical_dataset"},
                ),
                UniverseMembershipSnapshot(
                    universe_key=NASDAQ100_UNIVERSE_KEY,
                    universe_name=NASDAQ100_UNIVERSE_NAME,
                    effective_date=date(2026, 1, 1),
                    normalized_symbols=["AAPL"],
                    raw_symbols=["AAPL"],
                    unmapped_symbols=[],
                    source="static_seed",
                    fallback_source=None,
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="ndx100-2026-01-01",
                    source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
                    metadata={"coverage_mode": "point_in_time_anchor", "source_quality": "historical_dataset"},
                ),
            ]

    service = RealBacktestPlatformService(tmp_path / "zero-event-probe.db", market_data_provider=_Provider())
    service._universe_history_providers = lambda: [_UniverseProvider()]  # type: ignore[method-assign]

    overview = service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    corporate_snapshot = next(item for item in overview["dataset_snapshots"] if item["id"] == "ds-corporate-actions")
    coverage_rows = service.market_data_repository.load_dataset_symbol_coverage("ds-corporate-actions")

    assert corporate_snapshot["status"] == "READY"
    assert corporate_snapshot["metadata"]["missing_symbols"] == []
    assert corporate_snapshot["metadata"]["complete_no_events_symbol_count"] == len(coverage_rows)
    assert corporate_snapshot["metadata"]["formal_event_symbol_count"] == 0
    assert corporate_snapshot["metadata"]["probe_status_breakdown"] == {
        "complete_no_events": len(coverage_rows)
    }
    assert corporate_snapshot["metadata"]["provider_summary"]["providers"]["yahoo"]["selected_primary_symbols"] >= 1
    assert corporate_snapshot["metadata"]["provider_summary"]["providers"]["yahoo"]["actions_supported"] is True
    assert coverage_rows
    assert all(row["metadata"]["probe_status"] == "complete_no_events" for row in coverage_rows)
    assert all(row["metadata"]["event_scope"] == "dividend_split_only" for row in coverage_rows)


def test_snapshot_refresh_excludes_stooq_history_from_corporate_provider_summary(tmp_path):
    class _Provider:
        provider_name = "runtime"

        def fetch_history(self, symbol, start_date, end_date):
            return {
                "source": "stooq",
                "fallback_source": None,
                "bars": [
                    {
                        "date": "2026-04-10",
                        "open": 190.0,
                        "high": 191.0,
                        "low": 189.0,
                        "close": 190.5,
                        "adj_close": 190.5,
                        "volume": 1000,
                    }
                ],
                "actions": [],
                "warnings": [],
                "partial": False,
                "metadata": {
                    "provider_results": [
                        {
                            "provider": "stooq",
                            "kind": "history",
                            "status": "succeeded",
                            "source": "stooq",
                            "bar_count": 1,
                            "action_count": 0,
                            "partial": False,
                            "selection_status": "selected_primary",
                            "actions_supported": False,
                        }
                    ],
                },
            }

    class _UniverseProvider:
        provider_name = "test_universe"

        def load_snapshots(self, start_date: date, end_date: date):
            return [
                UniverseMembershipSnapshot(
                    universe_key=SP500_UNIVERSE_KEY,
                    universe_name=SP500_UNIVERSE_NAME,
                    effective_date=date(2026, 1, 1),
                    normalized_symbols=["AAPL"],
                    raw_symbols=["AAPL"],
                    unmapped_symbols=[],
                    source="static_seed",
                    fallback_source=None,
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="sp500-2026-01-01",
                    source_page_title=SP500_SOURCE_PAGE_TITLE,
                    metadata={"coverage_mode": "point_in_time_anchor", "source_quality": "historical_dataset"},
                ),
                UniverseMembershipSnapshot(
                    universe_key=NASDAQ100_UNIVERSE_KEY,
                    universe_name=NASDAQ100_UNIVERSE_NAME,
                    effective_date=date(2026, 1, 1),
                    normalized_symbols=["AAPL"],
                    raw_symbols=["AAPL"],
                    unmapped_symbols=[],
                    source="static_seed",
                    fallback_source=None,
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="ndx100-2026-01-01",
                    source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
                    metadata={"coverage_mode": "point_in_time_anchor", "source_quality": "historical_dataset"},
                ),
            ]

    service = RealBacktestPlatformService(tmp_path / "stooq-summary.db", market_data_provider=_Provider())
    service._universe_history_providers = lambda: [_UniverseProvider()]  # type: ignore[method-assign]

    overview = service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})
    refresh_stats = overview["latest_job"]["summary"]["refresh_stats"]
    price_summary = refresh_stats["datasets"]["ds-price"]["provider_summary"]
    corporate_summary = refresh_stats["datasets"]["ds-corporate-actions"]["provider_summary"]
    corporate_snapshot = next(item for item in overview["dataset_snapshots"] if item["id"] == "ds-corporate-actions")

    assert "stooq" in price_summary["providers"]
    assert "stooq" not in corporate_summary["providers"]
    assert corporate_snapshot["status"] == "INCOMPLETE"


def test_recent_running_snapshot_job_skips_interrupted_recovery_process_scan(tmp_path, monkeypatch):
    service = RealBacktestPlatformService(tmp_path / "snapshot-recent-running.db", market_data_provider=None)
    heartbeat_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    latest_job = {
        "id": "snap_recent",
        "status": "RUNNING",
        "updated_at": heartbeat_at,
        "summary": {
            "heartbeat_at": heartbeat_at,
            "current_stage": "preflight",
        },
        "warnings": [],
        "errors": [],
    }

    def _unexpected_process_scan(job_id: str) -> bool:
        raise AssertionError(f"unexpected process scan for {job_id}")

    monkeypatch.setattr(service, "_snapshot_refresh_process_is_active", _unexpected_process_scan)

    recovered = service._recover_interrupted_snapshot_job(latest_job)

    assert recovered is not None
    assert recovered["status"] == "RUNNING"
    assert recovered["id"] == "snap_recent"


def test_refresh_stats_reports_universe_anchor_progress_even_when_latest_members_are_unchanged(tmp_path):
    service = RealBacktestPlatformService(tmp_path / "snapshot-universe-progress.db", market_data_provider=None)

    current_snapshot = UniverseMembershipSnapshot(
        universe_key=NASDAQ100_UNIVERSE_KEY,
        universe_name=NASDAQ100_UNIVERSE_NAME,
        effective_date=date(2026, 1, 1),
        normalized_symbols=["AAPL", "MSFT"],
        raw_symbols=["AAPL", "MSFT"],
        unmapped_symbols=[],
        source="github_nasdaq100_curated_history",
        fallback_source=None,
        anchor_schedule=ANCHOR_SCHEDULE,
        source_revision_id=None,
        source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
        metadata={
            "coverage_mode": "point_in_time_anchor",
            "source_quality": "historical_dataset",
        },
    )
    memberships_by_snapshot = {
        NASDAQ100_UNIVERSE_SNAPSHOT_ID: [
            {
                "effective_date": "2026-01-01",
                "symbol": "AAPL",
                "raw_symbol": "AAPL",
                "source": "github_nasdaq100_curated_history",
                "fallback_source": None,
                "metadata": {"source_quality": "historical_dataset"},
            },
            {
                "effective_date": "2026-01-01",
                "symbol": "MSFT",
                "raw_symbol": "MSFT",
                "source": "github_nasdaq100_curated_history",
                "fallback_source": None,
                "metadata": {"source_quality": "historical_dataset"},
            },
        ]
    }
    existing_universe_memberships = {
        NASDAQ100_UNIVERSE_SNAPSHOT_ID: [
            {
                "effective_date": "2026-01-01",
                "symbol": "AAPL",
                "raw_symbol": "AAPL",
                "source": "wikipedia_current_page",
                "fallback_source": "wikipedia_revision_history",
                "metadata": {"source_quality": "current_page_fallback"},
            },
            {
                "effective_date": "2026-01-01",
                "symbol": "MSFT",
                "raw_symbol": "MSFT",
                "source": "wikipedia_current_page",
                "fallback_source": "wikipedia_revision_history",
                "metadata": {"source_quality": "current_page_fallback"},
            },
        ]
    }

    refresh_stats = service._build_refresh_stats(
        price_bars=[],
        corporate_actions=[],
        grouped_universe_snapshots={NASDAQ100_UNIVERSE_SNAPSHOT_ID: [current_snapshot]},
        memberships_by_snapshot=memberships_by_snapshot,
        existing_universe_memberships=existing_universe_memberships,
        dataset_provider_telemetry={},
    )

    universe_stat = refresh_stats["universes"][NASDAQ100_UNIVERSE_SNAPSHOT_ID]

    assert universe_stat["updated_row_count"] == 0
    assert universe_stat["anchor_count"] == 1
    assert universe_stat["previous_historical_anchor_count"] == 0
    assert universe_stat["historical_anchor_count"] == 1
    assert universe_stat["historical_anchor_delta"] == 1
    assert universe_stat["fallback_anchor_count"] == 0
    assert universe_stat["source_quality_breakdown"] == {"historical_dataset": 1}
    assert universe_stat["official_seed_status"] == "complete"
    assert universe_stat["official_seed_source_count"] == 0
    assert universe_stat["official_seed_missing_anchors"] == []


def test_universe_anchor_progress_ignores_off_schedule_legacy_member_dates():
    service = RealBacktestPlatformService(
        _manual_tmp_db_path("snapshot-off-schedule-universe-progress"),
        market_data_provider=None,
    )
    snapshots = [
        UniverseMembershipSnapshot(
            universe_key=SP500_UNIVERSE_KEY,
            universe_name=SP500_UNIVERSE_NAME,
            effective_date=date(2026, 1, 1),
            normalized_symbols=["AAPL", "MSFT"],
            raw_symbols=["AAPL", "MSFT"],
            unmapped_symbols=[],
            source="fmp_historical_constituent",
            fallback_source=None,
            anchor_schedule=ANCHOR_SCHEDULE,
            source_revision_id=None,
            source_page_title=SP500_SOURCE_PAGE_TITLE,
            metadata={"coverage_mode": "point_in_time_anchor", "source_quality": "historical_dataset"},
        ),
        UniverseMembershipSnapshot(
            universe_key=SP500_UNIVERSE_KEY,
            universe_name=SP500_UNIVERSE_NAME,
            effective_date=date(2026, 7, 1),
            normalized_symbols=["AAPL", "MSFT"],
            raw_symbols=["AAPL", "MSFT"],
            unmapped_symbols=[],
            source="fmp_historical_constituent",
            fallback_source=None,
            anchor_schedule=ANCHOR_SCHEDULE,
            source_revision_id=None,
            source_page_title=SP500_SOURCE_PAGE_TITLE,
            metadata={"coverage_mode": "point_in_time_anchor", "source_quality": "historical_dataset"},
        ),
        UniverseMembershipSnapshot(
            universe_key=SP500_UNIVERSE_KEY,
            universe_name=SP500_UNIVERSE_NAME,
            effective_date=date(2026, 1, 14),
            normalized_symbols=["AAPL", "MSFT"],
            raw_symbols=["AAPL", "MSFT"],
            unmapped_symbols=[],
            source="github_sp500_historical_components",
            fallback_source=None,
            anchor_schedule=ANCHOR_SCHEDULE,
            source_revision_id="github-current-2026-01-14",
            source_page_title=SP500_SOURCE_PAGE_TITLE,
            metadata={},
        ),
    ]

    progress = service._summarize_universe_anchor_progress(anchor_snapshots=snapshots)

    assert progress["anchor_count"] == 2
    assert progress["historical_anchor_count"] == 2
    assert progress["fallback_anchor_count"] == 0
    assert progress["ignored_off_schedule_anchor_count"] == 1


def test_snapshot_overview_normalizes_stale_universe_denominator_from_membership_rows():
    service = RealBacktestPlatformService(
        _manual_tmp_db_path("snapshot-stale-universe-denominator"),
        market_data_provider=None,
    )
    defaults = next(item for item in service._universe_snapshot_defaults() if item["id"] == SP500_UNIVERSE_SNAPSHOT_ID)

    formatted = service._format_universe_snapshot(
        {
            "id": SP500_UNIVERSE_SNAPSHOT_ID,
            "name": SP500_UNIVERSE_NAME,
            "status": "INCOMPLETE",
            "as_of": "2026-05-06T06:32:22Z",
            "freshness_label": "Historical anchors are still being repaired (61/2753)",
            "window_start": "1996-01-01",
            "window_end": "2026-05-06",
            "anchor_schedule": ANCHOR_SCHEDULE,
            "member_count": 503,
            "source": "mixed_sources",
            "fallback_source": None,
            "blocker": {
                "code": "UNIVERSE_HISTORY_INCOMPLETE",
                "message": "Universe history is partially available, but some historical anchors are still missing.",
            },
            "metadata": {
                "anchor_count": 2753,
                "historical_anchor_count": 61,
                "fallback_anchor_count": 2692,
                "source_quality_breakdown": {"historical_dataset": 61, "unknown": 2692},
            },
        },
        defaults,
    )

    assert formatted["status"] == "READY"
    assert formatted["blocker"] == {}
    assert formatted["freshness_label"] == "Historical anchors are complete"
    assert formatted["metadata"]["anchor_count"] == 61
    assert formatted["metadata"]["historical_anchor_count"] == 61
    assert formatted["metadata"]["fallback_anchor_count"] == 0
    assert formatted["metadata"]["raw_anchor_count"] == 2753
    assert formatted["metadata"]["ignored_off_schedule_anchor_count"] == 2692


def test_running_refresh_persists_partial_dataset_snapshots_before_completion(tmp_path):
    service = RealBacktestPlatformService(tmp_path / "snapshot-partial.db", market_data_provider=None)
    repository = service.market_data_repository
    coverage = [CoverageSummary(symbol="AAPL", start_date="2026-04-10", end_date="2026-04-10", trade_days=1)]

    service._persist_market_dataset_snapshots(
        as_of="2026-04-13T07:10:00Z",
        mode="repair",
        snapshot_window_start=date(1996, 1, 1),
        window_end=date(2026, 4, 10),
        selection_metadata={"selection_mode": "repair_missing_symbols_batch"},
        existing_price_snapshot=None,
        existing_corporate_snapshot=None,
        existing_price_rows={"price_bars": [], "symbol_coverage": []},
        existing_corporate_rows={"corporate_actions": [], "symbol_coverage": []},
        price_bars=[
            {
                "symbol": "AAPL",
                "date": "2026-04-10",
                "open": 190.0,
                "high": 191.0,
                "low": 189.5,
                "close": 190.5,
                "adj_close": 190.5,
                "volume": 1000,
                "source": "yahoo",
                "fallback_source": None,
            }
        ],
        corporate_actions=[
            {
                "symbol": "AAPL",
                "date": "2026-04-10",
                "action_type": "dividend",
                "value": 1.0,
                "source": "tiingo",
                "fallback_source": "yahoo",
                "payload": {"cash": 1.0},
            }
        ],
        coverage_rows=coverage,
        corporate_coverage_rows=coverage,
        effective_missing_symbols=["MSFT"],
        effective_corporate_missing_symbols=["MSFT"],
        action_partial=True,
        canonical_target_symbols=["AAPL", "MSFT"],
        canonical_total_symbol_count=2,
        default_source_name="yahoo",
        default_fallback_name="tiingo",
        cold_backup_result=None,
        recovery_report=None,
        running=True,
    )

    price_snapshot = next(item for item in repository.list_dataset_snapshots() if item["id"] == "ds-price")
    corporate_snapshot = next(item for item in repository.list_dataset_snapshots() if item["id"] == "ds-corporate-actions")

    assert price_snapshot["freshness_label"] == "后台更新中"
    assert price_snapshot["row_count"] == 1
    assert price_snapshot["metadata"]["covered_symbol_count"] == 1
    assert price_snapshot["metadata"]["total_symbol_count"] == 2
    assert price_snapshot["metadata"]["missing_symbols"] == ["MSFT"]
    assert corporate_snapshot["freshness_label"] == "后台更新中"
    assert corporate_snapshot["row_count"] == 1
    assert corporate_snapshot["metadata"]["covered_symbol_count"] == 1
    assert corporate_snapshot["metadata"]["total_symbol_count"] == 2
    assert corporate_snapshot["metadata"]["missing_symbols"] == ["MSFT"]


def test_repair_preserves_external_price_scope_when_later_provider_widens_symbol_pool(tmp_path):
    service = RealBacktestPlatformService(tmp_path / "snapshot-external-price-scope.db", market_data_provider=None)
    repository = service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "股票价格数据",
            "status": "INCOMPLETE",
            "as_of": "2026-05-05T09:00:00Z",
            "freshness_label": "外部补源后",
            "start_date": "2000-01-03",
            "end_date": "2017-11-10",
            "row_count": 2,
            "source": "kaggle_bulk_cache",
            "fallback_source": None,
            "blocker": {"code": "PRICE_SNAPSHOT_INCOMPLETE"},
            "metadata": {
                "total_symbol_count": 4,
                "target_symbol_count": 4,
                "covered_symbol_count": 2,
                "missing_symbols": ["BFB", "NWS-A"],
                "provider_summary": {
                    "attempted_providers": ["kaggle_huge_stock_market_dataset"],
                    "providers": {
                        "kaggle_huge_stock_market_dataset": {
                            "status": "succeeded",
                            "landed_row_count": 2,
                            "landed_symbol_count": 2,
                            "pit_mode": "price_only",
                        }
                    },
                },
                "last_external_repair_at": "2026-05-05T09:10:00Z",
            },
        },
        price_bars=[
            {
                "symbol": "AAPL",
                "date": "2017-11-10",
                "open": 1.0,
                "high": 1.0,
                "low": 1.0,
                "close": 1.0,
                "adj_close": 1.0,
                "volume": 100,
                "source": "kaggle_bulk_cache",
            },
            {
                "symbol": "MSFT",
                "date": "2017-11-10",
                "open": 2.0,
                "high": 2.0,
                "low": 2.0,
                "close": 2.0,
                "adj_close": 2.0,
                "volume": 200,
                "source": "kaggle_bulk_cache",
            },
        ],
        symbol_coverage=[
            {"symbol": "AAPL", "start_date": "2000-01-03", "end_date": "2017-11-10", "trade_days": 1, "source": "kaggle_bulk_cache"},
            {"symbol": "MSFT", "start_date": "2000-01-03", "end_date": "2017-11-10", "trade_days": 1, "source": "kaggle_bulk_cache"},
        ],
    )
    existing_price_snapshot = next(item for item in repository.list_dataset_snapshots() if item["id"] == "ds-price")
    existing_price_rows = repository.load_dataset_snapshot_rows("ds-price")

    service._persist_market_dataset_snapshots(
        as_of="2026-05-05T10:00:00Z",
        mode="repair",
        snapshot_window_start=date(2000, 1, 3),
        window_end=date(2026, 5, 5),
        selection_metadata={"selection_mode": "repair_missing_symbols_batch"},
        existing_price_snapshot=existing_price_snapshot,
        existing_corporate_snapshot=None,
        existing_price_rows=existing_price_rows,
        existing_corporate_rows={"corporate_actions": [], "symbol_coverage": []},
        price_bars=[
            {
                "symbol": "BFB",
                "date": "2017-11-10",
                "open": 3.0,
                "high": 3.0,
                "low": 3.0,
                "close": 3.0,
                "adj_close": 3.0,
                "volume": 300,
                "source": "yahoo",
            },
            {
                "symbol": "GPS",
                "date": "2026-05-05",
                "open": 4.0,
                "high": 4.0,
                "low": 4.0,
                "close": 4.0,
                "adj_close": 4.0,
                "volume": 400,
                "source": "yahoo",
            },
        ],
        corporate_actions=[],
        coverage_rows=[
            {"symbol": "BFB", "start_date": "2017-11-10", "end_date": "2017-11-10", "trade_days": 1, "source": "yahoo"},
            {"symbol": "GPS", "start_date": "2026-05-05", "end_date": "2026-05-05", "trade_days": 1, "source": "yahoo"},
        ],
        corporate_coverage_rows=[],
        effective_missing_symbols=["NWS-A"],
        effective_corporate_missing_symbols=[],
        action_partial=False,
        canonical_target_symbols=["AAPL", "MSFT", "BFB", "NWS-A", "GMCR", "GPS"],
        canonical_total_symbol_count=6,
        default_source_name="yahoo",
        default_fallback_name=None,
    )

    price_snapshot = next(item for item in repository.list_dataset_snapshots() if item["id"] == "ds-price")
    metadata = price_snapshot["metadata"]

    assert metadata["preserved_external_repair_scope"] is True
    assert metadata["total_symbol_count"] == 4
    assert metadata["target_symbol_count"] == 4
    assert metadata["covered_symbol_count"] == 3
    assert metadata["missing_symbols"] == ["NWS-A"]
    providers = metadata["provider_summary"]["providers"]
    assert "kaggle_huge_stock_market_dataset" in providers
    assert providers["yahoo"]["landed_symbol_count"] == 2


def test_snapshot_refresh_counts_fmp_history_anchors_as_ready(tmp_path):
    class _FakeUniverseProvider:
        provider_name = "fmp_historical_constituent"

        def load_snapshots(self, start_date: date, end_date: date):
            return [
                UniverseMembershipSnapshot(
                    universe_key=SP500_UNIVERSE_KEY,
                    universe_name=SP500_UNIVERSE_NAME,
                    effective_date=date(2026, 1, 1),
                    normalized_symbols=["AAPL", "MSFT"],
                    raw_symbols=["AAPL", "MSFT"],
                    unmapped_symbols=[],
                    source="fmp_historical_constituent",
                    fallback_source=None,
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="fmp-sp500-2026-01-01",
                    source_page_title=SP500_SOURCE_PAGE_TITLE,
                    metadata={"coverage_mode": "point_in_time_anchor", "source_quality": "historical_constituent_api"},
                ),
                UniverseMembershipSnapshot(
                    universe_key=NASDAQ100_UNIVERSE_KEY,
                    universe_name=NASDAQ100_UNIVERSE_NAME,
                    effective_date=date(2026, 1, 1),
                    normalized_symbols=["AAPL", "MSFT"],
                    raw_symbols=["AAPL", "MSFT"],
                    unmapped_symbols=[],
                    source="fmp_historical_constituent",
                    fallback_source=None,
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="fmp-ndx100-2026-01-01",
                    source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
                    metadata={"coverage_mode": "point_in_time_anchor", "source_quality": "historical_constituent_api"},
                ),
            ]

    service = RealBacktestPlatformService(tmp_path / "fmp-ready.db", market_data_provider=None)
    service._universe_history_providers = lambda: [_FakeUniverseProvider()]  # type: ignore[method-assign]

    overview = service.refresh_snapshots({"mode": "repair", "targets": ["universes"]})

    assert [item["status"] for item in overview["universe_snapshots"]] == ["READY", "READY"]


def test_snapshot_refresh_surfaces_fmp_probe_status_when_universe_falls_back(tmp_path):
    class _FallbackUniverseProvider:
        provider_name = "fmp_historical_constituent"

        def load_snapshots(self, start_date: date, end_date: date):
            return [
                UniverseMembershipSnapshot(
                    universe_key=SP500_UNIVERSE_KEY,
                    universe_name=SP500_UNIVERSE_NAME,
                    effective_date=date(2025, 7, 1),
                    normalized_symbols=["AAPL", "MSFT"],
                    raw_symbols=["AAPL", "MSFT"],
                    unmapped_symbols=[],
                    source="wikipedia_revision_history",
                    fallback_source=None,
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="wiki-sp500-2025-07-01",
                    source_page_title=SP500_SOURCE_PAGE_TITLE,
                    metadata={
                        "coverage_mode": "point_in_time_anchor",
                        "source_quality": "historical_revision_snapshot",
                        "historical_constituent_provider": "fmp",
                        "historical_constituent_probe_status": "capability_unavailable",
                    },
                ),
                UniverseMembershipSnapshot(
                    universe_key=SP500_UNIVERSE_KEY,
                    universe_name=SP500_UNIVERSE_NAME,
                    effective_date=date(2026, 1, 1),
                    normalized_symbols=["AAPL", "MSFT"],
                    raw_symbols=["AAPL", "MSFT"],
                    unmapped_symbols=[],
                    source="wikipedia_revision_history",
                    fallback_source="wikipedia_current_page",
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="wiki-sp500-2026-01-01",
                    source_page_title=SP500_SOURCE_PAGE_TITLE,
                    metadata={
                        "coverage_mode": "point_in_time_anchor",
                        "source_quality": "current_page_fallback",
                        "historical_constituent_provider": "fmp",
                        "historical_constituent_probe_status": "capability_unavailable",
                    },
                ),
                UniverseMembershipSnapshot(
                    universe_key=NASDAQ100_UNIVERSE_KEY,
                    universe_name=NASDAQ100_UNIVERSE_NAME,
                    effective_date=date(2025, 7, 1),
                    normalized_symbols=["AAPL", "MSFT"],
                    raw_symbols=["AAPL", "MSFT"],
                    unmapped_symbols=[],
                    source="wikipedia_revision_history",
                    fallback_source=None,
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="wiki-ndx100-2025-07-01",
                    source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
                    metadata={
                        "coverage_mode": "point_in_time_anchor",
                        "source_quality": "historical_revision_snapshot",
                        "historical_constituent_provider": "fmp",
                        "historical_constituent_probe_status": "capability_unavailable",
                    },
                ),
                UniverseMembershipSnapshot(
                    universe_key=NASDAQ100_UNIVERSE_KEY,
                    universe_name=NASDAQ100_UNIVERSE_NAME,
                    effective_date=date(2026, 1, 1),
                    normalized_symbols=["AAPL", "MSFT"],
                    raw_symbols=["AAPL", "MSFT"],
                    unmapped_symbols=[],
                    source="wikipedia_revision_history",
                    fallback_source="wikipedia_current_page",
                    anchor_schedule=ANCHOR_SCHEDULE,
                    source_revision_id="wiki-ndx100-2026-01-01",
                    source_page_title=NASDAQ100_SOURCE_PAGE_TITLE,
                    metadata={
                        "coverage_mode": "point_in_time_anchor",
                        "source_quality": "current_page_fallback",
                        "historical_constituent_provider": "fmp",
                        "historical_constituent_probe_status": "capability_unavailable",
                    },
                ),
            ]

    service = RealBacktestPlatformService(tmp_path / "fmp-fallback-warning.db", market_data_provider=None)
    service._universe_history_providers = lambda: [_FallbackUniverseProvider()]  # type: ignore[method-assign]

    overview = service.refresh_snapshots({"mode": "repair", "targets": ["universes"]})

    warnings = overview["latest_job"]["warnings"]
    assert any("FMP historical constituent capability unavailable" in warning for warning in warnings)


def test_snapshot_refresh_returns_refreshed_overview_with_embedded_latest_job(tmp_path):
    client, _ = create_test_client(tmp_path)

    refreshed = assert_ok(
        client.post(
            "/admin/snapshot-refresh-jobs",
            json={
                "reason": "test-run",
                "mode": "repair",
                "targets": ["price", "corporate", "universes"],
            },
        )
    )

    assert_snapshot_overview_contract(refreshed)
    assert refreshed["overall_status"] == "READY"
    assert refreshed["latest_job"] is not None
    assert refreshed["latest_job"]["request"]["reason"] == "test-run"
    assert refreshed["latest_job"]["request"]["mode"] == "repair"
    assert refreshed["latest_job"]["request"]["targets"] == ["price", "corporate", "universes"]
    assert refreshed["latest_job"]["summary"]["status"] == "READY"
    assert refreshed["latest_job"]["summary"]["mode"] == "repair"
    assert refreshed["latest_job"]["summary"]["dataset_snapshot_id"] == "ds-price"
    assert "refresh_stats" in refreshed["latest_job"]["summary"]
    assert "datasets" in refreshed["latest_job"]["summary"]["refresh_stats"]
    assert "universes" in refreshed["latest_job"]["summary"]["refresh_stats"]
    assert [(item["id"], item["status"]) for item in refreshed["dataset_snapshots"]] == [
        ("ds-corporate-actions", "READY"),
        ("ds-price", "READY"),
        ("ds-index-valuations", "INCOMPLETE"),
    ]
    assert [item["status"] for item in refreshed["universe_snapshots"]] == ["READY", "READY"]
    assert refreshed["allowed_actions"] == ["refresh_snapshots"]


def test_snapshot_overview_seeds_legacy_local_cache_when_snapshot_tables_are_empty(tmp_path):
    client, db_path = create_test_client(tmp_path)
    market_data_path = db_path.with_name(f"{db_path.stem}_market_data.sqlite3")
    repository = MarketDataRepository(market_data_path)
    repository.replace_bars(
        "AAPL",
        [
            {"date": "2025-05-16", "open": 210.0, "high": 212.0, "low": 209.0, "close": 211.0, "adj_close": 211.0, "volume": 1000},
            {"date": "2025-05-19", "open": 211.0, "high": 213.0, "low": 210.5, "close": 212.0, "adj_close": 212.0, "volume": 1100},
        ],
    )
    repository.replace_bars(
        "SPY",
        [
            {"date": "2025-05-16", "open": 500.0, "high": 502.0, "low": 499.5, "close": 501.0, "adj_close": 501.0, "volume": 2000},
            {"date": "2025-05-19", "open": 501.0, "high": 503.0, "low": 500.0, "close": 502.0, "adj_close": 502.0, "volume": 2100},
        ],
    )
    repository.replace_coverages(
        [
            CoverageSummary(symbol="AAPL", start_date="2025-05-16", end_date="2025-05-19", trade_days=2),
            CoverageSummary(symbol="SPY", start_date="2025-05-16", end_date="2025-05-19", trade_days=2),
        ]
    )

    overview = assert_ok(client.get("/data-snapshots/overview"))
    price_snapshot = next(item for item in overview["dataset_snapshots"] if item["id"] == "ds-price")
    actions_snapshot = next(item for item in overview["dataset_snapshots"] if item["id"] == "ds-corporate-actions")

    assert price_snapshot["status"] == "STALE"
    assert price_snapshot["row_count"] == 4
    assert price_snapshot["source"] == "legacy_local_cache"
    assert price_snapshot["freshness_label"] == "已从本地缓存恢复"
    assert actions_snapshot["status"] == "INCOMPLETE"
    assert actions_snapshot["source"] == "legacy_local_cache"
    assert "本地暂时没有公司行为快照" in actions_snapshot["blocker"]["message"]


def test_start_snapshot_refresh_returns_running_overview_immediately(tmp_path, monkeypatch):
    service = RealBacktestPlatformService(tmp_path / "async.db", market_data_provider=None)
    finished = threading.Event()

    def fake_refresh(payload):
        finished.set()
        return {"overall_status": "READY"}

    monkeypatch.setattr(service, "refresh_snapshots", fake_refresh)

    overview = service.start_snapshot_refresh({"reason": "async-check"})

    assert overview["overall_status"] == "RUNNING"
    assert overview["latest_job"]["status"] == "RUNNING"
    assert overview["message"] == "正在刷新快照，页面会自动更新。当前先显示已有数据。"
    assert finished.wait(1)


def test_start_snapshot_refresh_updates_same_job_when_background_work_finishes(tmp_path, monkeypatch):
    service = RealBacktestPlatformService(tmp_path / "async-finish.db", market_data_provider=None)
    finished = threading.Event()
    observed_payloads: list[dict[str, Any]] = []

    def fake_refresh(payload):
        observed_payloads.append(dict(payload))
        finished.set()
        return {"overall_status": "READY", "blocking_code": None, "blocking_target": None, "message": "快照已准备好。"}

    monkeypatch.setattr(service, "refresh_snapshots", fake_refresh)

    running = service.start_snapshot_refresh({"reason": "async-finish"})

    assert finished.wait(1)
    overview = None
    deadline = datetime.now(timezone.utc) + timedelta(seconds=2)
    while datetime.now(timezone.utc) < deadline:
        candidate = service.get_snapshot_overview()
        if candidate["latest_job"]["status"] == "READY":
            overview = candidate
            break
    assert overview is not None

    assert observed_payloads
    assert observed_payloads[0]["_job_id"] == running["latest_job"]["id"]
    assert overview["latest_job"]["id"] == running["latest_job"]["id"]
    assert overview["latest_job"]["status"] == "READY"
    assert overview["latest_job"]["summary"]["status"] == "READY"
    assert overview["latest_job"]["summary"]["blocking"] is False
    rows = service.storage.fetch_all("SELECT id, status FROM snapshot_refresh_jobs ORDER BY created_at DESC")
    assert len(rows) == 1
    assert rows[0]["id"] == running["latest_job"]["id"]
    assert rows[0]["status"] == "READY"


def test_start_snapshot_refresh_uses_subprocess_runtime_state_outside_pytest(tmp_path, monkeypatch):
    service = RealBacktestPlatformService(tmp_path / "async-process.db", market_data_provider=None)

    class FakePopen:
        def __init__(self, command, cwd=None, env=None, creationflags=0):
            self.command = list(command)
            self.cwd = cwd
            self.env = dict(env or {})
            self.creationflags = creationflags
            self.pid = 43210

        def poll(self):
            return None

    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setattr(real_service_module.subprocess, "Popen", FakePopen)
    monkeypatch.setattr(service, "_pid_is_running", lambda pid: pid == 43210)

    running = service.start_snapshot_refresh({"reason": "prod-async"})
    overview = service.get_snapshot_overview()
    runtime_state = service._load_snapshot_refresh_runtime_state()

    assert running["latest_job"]["status"] == "RUNNING"
    assert overview["latest_job"]["id"] == running["latest_job"]["id"]
    assert overview["latest_job"]["status"] == "RUNNING"
    assert runtime_state is not None
    assert runtime_state["job_id"] == running["latest_job"]["id"]
    assert runtime_state["pid"] == 43210


def test_pid_is_running_accepts_current_process_on_windows(tmp_path):
    service = RealBacktestPlatformService(tmp_path / "pid-check.db", market_data_provider=None)
    assert service._pid_is_running(os.getpid()) is True


def test_snapshot_overview_treats_running_worker_process_as_active_even_without_runtime_state(tmp_path, monkeypatch):
    service = RealBacktestPlatformService(tmp_path / "process-scan.db", market_data_provider=None)
    service.storage.insert_json_row(
        "snapshot_refresh_jobs",
        {
            "id": "snap-subprocess",
            "status": "RUNNING",
            "request_json": json.dumps({"reason": "subprocess"}),
            "summary_json": json.dumps({"status": "RUNNING"}),
            "warnings_json": json.dumps([]),
            "errors_json": json.dumps([]),
            "created_at": "2026-04-08T05:57:46Z",
            "updated_at": "2026-04-08T05:57:46Z",
            "started_at": "2026-04-08T05:57:46Z",
            "completed_at": None,
        },
    )
    monkeypatch.setattr(service, "_find_snapshot_refresh_worker_pid", lambda job_id: 43210 if job_id == "snap-subprocess" else None)

    overview = service.get_snapshot_overview()

    assert overview["latest_job"]["id"] == "snap-subprocess"
    assert overview["latest_job"]["status"] == "RUNNING"


def test_snapshot_overview_recovers_interrupted_running_job_after_restart(tmp_path):
    service = RealBacktestPlatformService(tmp_path / "recover.db", market_data_provider=None)
    service.storage.insert_json_row(
        "snapshot_refresh_jobs",
        {
            "id": "snap-orphaned",
            "status": "RUNNING",
            "request_json": json.dumps({"reason": "restart"}),
            "summary_json": json.dumps({"status": "RUNNING"}),
            "warnings_json": json.dumps([]),
            "errors_json": json.dumps([]),
            "created_at": "2026-04-02T05:15:11Z",
            "updated_at": "2026-04-02T05:15:11Z",
            "started_at": "2026-04-02T05:15:11Z",
            "completed_at": None,
        },
    )

    overview = service.get_snapshot_overview()

    assert overview["latest_job"]["status"] == "FAILED"
    assert overview["latest_job"]["summary"]["blocking_code"] == "SNAPSHOT_REFRESH_INTERRUPTED"
    assert overview["allowed_actions"] == ["refresh_snapshots"]


def test_repair_refresh_preserves_existing_snapshot_rows_when_only_subset_is_repaired(tmp_path):
    service = RealBacktestPlatformService(tmp_path / "repair-preserve.db", market_data_provider=None)
    repository = service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "股票价格数据",
            "status": "INCOMPLETE",
            "as_of": "2026-04-02T01:00:00Z",
            "freshness_label": "已有快照",
            "start_date": "2025-05-16",
            "end_date": "2025-05-19",
            "row_count": 2,
            "source": "legacy_local_cache",
            "fallback_source": "live_refresh_pending",
            "blocker": {"code": "PRICE_SNAPSHOT_INCOMPLETE", "message": "waiting"},
            "metadata": {},
        },
        price_bars=[
            {
                "symbol": "AAPL",
                "date": "2025-05-16",
                "open": 210.0,
                "high": 212.0,
                "low": 209.0,
                "close": 211.0,
                "adj_close": 211.0,
                "volume": 1000,
                "source": "legacy_local_cache",
                "fallback_source": "live_refresh_pending",
                "metadata": {},
            },
            {
                "symbol": "AAPL",
                "date": "2025-05-19",
                "open": 211.0,
                "high": 213.0,
                "low": 210.5,
                "close": 212.0,
                "adj_close": 212.0,
                "volume": 1100,
                "source": "legacy_local_cache",
                "fallback_source": "live_refresh_pending",
                "metadata": {},
            },
        ],
        symbol_coverage=[
            CoverageSummary(symbol="AAPL", start_date="2025-05-16", end_date="2025-05-19", trade_days=2),
        ],
    )
    repository.replace_universe_snapshot(
        {
            "id": SP500_UNIVERSE_SNAPSHOT_ID,
            "universe_key": SP500_UNIVERSE_KEY,
            "name": "标普500",
            "status": "INCOMPLETE",
            "as_of": "2026-04-02T01:00:00Z",
            "freshness_label": "历史锚点补齐中 (1/2)",
            "window_start": "2025-01-01",
            "window_end": "2025-07-01",
            "anchor_schedule": "01-01,07-01",
            "member_count": 1,
            "source": "wikipedia_revision_history",
            "fallback_source": None,
            "metadata": {},
        },
        memberships=[
            {"effective_date": "2025-01-01", "symbol": "AAPL", "source": "wikipedia_revision_history"},
            {"effective_date": "2025-07-01", "symbol": "MSFT", "source": "wikipedia_revision_history"},
        ],
    )

    class _SubsetProvider:
        provider_name = "subset_provider"

        def fetch_history(self, symbol, start_date, end_date):
            if symbol != "MSFT":
                raise RuntimeError(f"No usable daily bars returned for {symbol}")
            return {
                "source": "subset_provider",
                "fallback_source": None,
                "bars": [
                    {
                        "date": "2025-05-16",
                        "open": 310.0,
                        "high": 312.0,
                        "low": 309.0,
                        "close": 311.0,
                        "adj_close": 311.0,
                        "volume": 2000,
                    }
                ],
                "actions": [],
                "warnings": [],
                "partial": False,
                "metadata": {},
            }

    service.market_data_provider = _SubsetProvider()

    refreshed = service.refresh_snapshots({"reason": "repair-preserve", "mode": "repair", "targets": ["price"]})
    price_snapshot = next(item for item in refreshed["dataset_snapshots"] if item["id"] == "ds-price")
    price_rows = repository.load_dataset_snapshot_rows("ds-price")["price_bars"]

    assert price_snapshot["row_count"] == 3
    assert {row["symbol"] for row in price_rows} == {"AAPL", "MSFT"}


def test_snapshot_overview_repairs_placeholder_snapshot_headers_from_existing_rows(tmp_path):
    service = RealBacktestPlatformService(tmp_path / "repair.db", market_data_provider=None)
    repository = service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "股票价格数据",
            "status": "STALE",
            "as_of": "2026-04-02T01:00:00Z",
            "freshness_label": "已从本地缓存恢复",
            "start_date": "2025-05-16",
            "end_date": "2025-05-19",
            "row_count": 2,
            "source": "legacy_local_cache",
            "fallback_source": "live_refresh_pending",
            "blocker": {"code": "LIVE_REFRESH_PENDING", "message": "waiting"},
            "metadata": {},
        },
        price_bars=[
            {
                "symbol": "AAPL",
                "date": "2025-05-16",
                "open": 210.0,
                "high": 212.0,
                "low": 209.0,
                "close": 211.0,
                "adj_close": 211.0,
                "volume": 1000,
                "source": "legacy_local_cache",
                "fallback_source": "live_refresh_pending",
                "metadata": {},
            },
            {
                "symbol": "AAPL",
                "date": "2025-05-19",
                "open": 211.0,
                "high": 213.0,
                "low": 210.5,
                "close": 212.0,
                "adj_close": 212.0,
                "volume": 1100,
                "source": "legacy_local_cache",
                "fallback_source": "live_refresh_pending",
                "metadata": {},
            },
        ],
        symbol_coverage=[
            CoverageSummary(symbol="AAPL", start_date="2025-05-16", end_date="2025-05-19", trade_days=2),
        ],
    )
    repository.replace_dataset_snapshot(
        {
            "id": "ds-corporate-actions",
            "name": "公司行为数据",
            "status": "STALE",
            "as_of": "2026-04-02T01:00:00Z",
            "freshness_label": "已从本地缓存恢复",
            "start_date": "2025-05-16",
            "end_date": "2025-05-19",
            "row_count": 1,
            "source": "legacy_local_cache",
            "fallback_source": "live_refresh_pending",
            "blocker": {"code": "LIVE_REFRESH_PENDING", "message": "waiting"},
            "metadata": {},
        },
        corporate_actions=[
            {
                "symbol": "AAPL",
                "date": "2025-05-19",
                "action_type": "dividend",
                "value": 1.0,
                "source": "legacy_local_cache",
                "fallback_source": "live_refresh_pending",
                "payload": {"cash": 1.0},
            }
        ],
    )
    repository.replace_universe_snapshot(
        {
            "id": SP500_UNIVERSE_SNAPSHOT_ID,
            "universe_key": SP500_UNIVERSE_KEY,
            "name": "标普500",
            "status": "INCOMPLETE",
            "as_of": "2026-04-02T01:00:00Z",
            "freshness_label": "历史锚点补齐中 (1/2)",
            "window_start": "2025-01-01",
            "window_end": "2025-07-01",
            "anchor_schedule": "01-01,07-01",
            "member_count": 2,
            "source": "wikipedia_revision_history",
            "fallback_source": None,
            "blocker": {"code": "UNIVERSE_HISTORY_INCOMPLETE", "message": "waiting"},
            "metadata": {},
        },
        memberships=[
            {"effective_date": "2025-01-01", "symbol": "AAPL", "raw_symbol": "AAPL", "membership_status": "ACTIVE", "source": "wikipedia_revision_history", "fallback_source": None, "metadata": {}},
            {"effective_date": "2025-01-01", "symbol": "MSFT", "raw_symbol": "MSFT", "membership_status": "ACTIVE", "source": "wikipedia_revision_history", "fallback_source": None, "metadata": {}},
        ],
    )
    with repository.connect() as conn:
        conn.execute(
            """
            UPDATE dataset_snapshots
            SET row_count = 0, as_of = NULL, freshness_label = '尚未刷新', source = '', fallback_source = NULL,
                blocker_json = '{}', metadata_json = '{"total_symbol_count": 1398}'
            WHERE id IN ('ds-price', 'ds-corporate-actions')
            """
        )
        conn.execute(
            """
            UPDATE universe_snapshots
            SET member_count = 0, as_of = NULL, freshness_label = '尚未刷新', source = '', fallback_source = NULL,
                blocker_json = '{}', metadata_json = '{}'
            WHERE id = ?
            """,
            (SP500_UNIVERSE_SNAPSHOT_ID,),
        )

    overview = service.get_snapshot_overview()
    price_snapshot = next(item for item in overview["dataset_snapshots"] if item["id"] == "ds-price")
    actions_snapshot = next(item for item in overview["dataset_snapshots"] if item["id"] == "ds-corporate-actions")
    universe_snapshot = next(item for item in overview["universe_snapshots"] if item["id"] == SP500_UNIVERSE_SNAPSHOT_ID)

    assert price_snapshot["row_count"] == 2
    assert price_snapshot["freshness_label"] == "已从现有快照恢复"
    assert price_snapshot["metadata"]["covered_symbol_count"] == 1
    assert price_snapshot["metadata"]["total_symbol_count"] == 2
    assert actions_snapshot["row_count"] == 1
    assert actions_snapshot["freshness_label"] == "已从现有快照恢复"
    assert actions_snapshot["metadata"]["covered_symbol_count"] == 1
    assert actions_snapshot["metadata"]["total_symbol_count"] == 2
    assert universe_snapshot["member_count"] == 2
    assert universe_snapshot["freshness_label"] == "已从现有快照恢复"


def test_snapshot_overview_uses_independent_company_action_progress(tmp_path):
    service = RealBacktestPlatformService(tmp_path / "independent-corporate.db", market_data_provider=None)
    repository = service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "股票价格数据",
            "status": "STALE",
            "as_of": "2026-04-02T01:00:00Z",
            "freshness_label": "已从本地缓存恢复",
            "start_date": "2025-05-16",
            "end_date": "2025-05-19",
            "row_count": 2,
            "source": "legacy_local_cache",
            "fallback_source": "live_refresh_pending",
            "blocker": {"code": "LIVE_REFRESH_PENDING", "message": "waiting"},
            "metadata": {},
        },
        price_bars=[
            {
                "symbol": "AAPL",
                "date": "2025-05-16",
                "open": 210.0,
                "high": 212.0,
                "low": 209.0,
                "close": 211.0,
                "adj_close": 211.0,
                "volume": 1000,
                "source": "legacy_local_cache",
                "fallback_source": "live_refresh_pending",
                "metadata": {},
            },
            {
                "symbol": "MSFT",
                "date": "2025-05-19",
                "open": 411.0,
                "high": 413.0,
                "low": 410.5,
                "close": 412.0,
                "adj_close": 412.0,
                "volume": 1100,
                "source": "legacy_local_cache",
                "fallback_source": "live_refresh_pending",
                "metadata": {},
            },
        ],
        symbol_coverage=[
            CoverageSummary(symbol="AAPL", start_date="2025-05-16", end_date="2025-05-19", trade_days=2),
            CoverageSummary(symbol="MSFT", start_date="2025-05-16", end_date="2025-05-19", trade_days=2),
        ],
    )
    repository.replace_dataset_snapshot(
        {
            "id": "ds-corporate-actions",
            "name": "公司行为数据",
            "status": "STALE",
            "as_of": "2026-04-02T01:00:00Z",
            "freshness_label": "已从本地缓存恢复",
            "start_date": "2025-05-16",
            "end_date": "2025-05-19",
            "row_count": 1,
            "source": "legacy_local_cache",
            "fallback_source": "live_refresh_pending",
            "blocker": {"code": "LIVE_REFRESH_PENDING", "message": "waiting"},
            "metadata": {"total_symbol_count": 2},
        },
        corporate_actions=[
            {
                "symbol": "AAPL",
                "date": "2025-05-19",
                "action_type": "dividend",
                "value": 1.0,
                "source": "legacy_local_cache",
                "fallback_source": "live_refresh_pending",
                "payload": {"cash": 1.0},
            }
        ],
        symbol_coverage=[
            CoverageSummary(symbol="AAPL", start_date="2025-05-19", end_date="2025-05-19", trade_days=1),
            CoverageSummary(symbol="MSFT", start_date="2025-05-19", end_date="2025-05-19", trade_days=1),
        ],
    )

    overview = service.get_snapshot_overview()
    price_snapshot = next(item for item in overview["dataset_snapshots"] if item["id"] == "ds-price")
    actions_snapshot = next(item for item in overview["dataset_snapshots"] if item["id"] == "ds-corporate-actions")

    assert price_snapshot["metadata"]["covered_symbol_count"] == 2
    assert price_snapshot["metadata"]["total_symbol_count"] == 2
    assert actions_snapshot["metadata"]["covered_symbol_count"] == 2
    assert actions_snapshot["metadata"]["total_symbol_count"] == 2


def test_snapshot_overview_publishes_benchmark_etf_price_history_coverage(tmp_path):
    service = RealBacktestPlatformService(tmp_path / "benchmark-etf-coverage.db", market_data_provider=None)
    repository = service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "股票价格数据",
            "status": "INCOMPLETE",
            "as_of": "2026-04-02T01:00:00Z",
            "freshness_label": "已刷新",
            "start_date": "1996-01-02",
            "end_date": "2026-04-01",
            "row_count": 5,
            "source": "legacy_local_cache",
            "fallback_source": None,
            "blocker": {"code": "PRICE_SNAPSHOT_INCOMPLETE", "message": "waiting"},
            "metadata": {"covered_symbol_count": 1, "total_symbol_count": 3},
        },
        price_bars=[
            {
                "symbol": "SPY",
                "date": "1996-01-02",
                "open": 100.0,
                "high": 101.0,
                "low": 99.0,
                "close": 100.5,
                "adj_close": 100.5,
                "volume": 1000,
                "source": "legacy_local_cache",
                "fallback_source": None,
            },
            {
                "symbol": "SPY",
                "date": "2026-04-01",
                "open": 500.0,
                "high": 501.0,
                "low": 499.0,
                "close": 500.5,
                "adj_close": 500.5,
                "volume": 1000,
                "source": "legacy_local_cache",
                "fallback_source": None,
            },
            {
                "symbol": "QQQ",
                "date": "1999-03-10",
                "open": 50.0,
                "high": 51.0,
                "low": 49.0,
                "close": 50.5,
                "adj_close": 50.5,
                "volume": 1000,
                "source": "legacy_local_cache",
                "fallback_source": None,
            },
            {
                "symbol": "QQQ",
                "date": "2026-04-01",
                "open": 400.0,
                "high": 401.0,
                "low": 399.0,
                "close": 400.5,
                "adj_close": 400.5,
                "volume": 1000,
                "source": "legacy_local_cache",
                "fallback_source": None,
            },
            {
                "symbol": "AAPL",
                "date": "2026-04-01",
                "open": 210.0,
                "high": 211.0,
                "low": 209.0,
                "close": 210.5,
                "adj_close": 210.5,
                "volume": 1000,
                "source": "legacy_local_cache",
                "fallback_source": None,
            },
        ],
        symbol_coverage=[CoverageSummary(symbol="AAPL", start_date="2026-04-01", end_date="2026-04-01", trade_days=1)],
    )

    overview = service.get_snapshot_overview()
    price_snapshot = next(item for item in overview["dataset_snapshots"] if item["id"] == "ds-price")
    coverage = price_snapshot["metadata"]["benchmark_etf_coverage"]

    assert coverage["ready_count"] == 2
    assert coverage["total_count"] == 2
    assert coverage["missing_symbols"] == []
    by_symbol = {item["symbol"]: item for item in coverage["symbols"]}
    assert by_symbol["SPY"]["status"] == "READY"
    assert by_symbol["SPY"]["start_date"] == "1996-01-02"
    assert by_symbol["SPY"]["end_date"] == "2026-04-01"
    assert by_symbol["QQQ"]["status"] == "READY"
    assert by_symbol["QQQ"]["start_date"] == "1999-03-10"


def test_repair_refresh_batches_missing_symbols_without_dropping_unattempted_gaps(tmp_path, monkeypatch):
    monkeypatch.setattr(real_service_module, "SNAPSHOT_REPAIR_SYMBOL_BATCH_SIZE", 2)
    class _Provider:
        provider_name = "repair_batch_provider"

        def fetch_history(self, symbol, start_date, end_date):
            return {
                "source": self.provider_name,
                "fallback_source": None,
                "bars": [
                    {
                        "date": "2026-04-08",
                        "open": 10.0,
                        "high": 11.0,
                        "low": 9.0,
                        "close": 10.5,
                        "adj_close": 10.5,
                        "volume": 1000,
                    }
                ],
                "actions": [],
                "warnings": [],
                "partial": False,
                "metadata": {},
            }

    service = RealBacktestPlatformService(tmp_path / "repair-batch.db", market_data_provider=_Provider())
    repository = service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "股票价格数据",
            "status": "INCOMPLETE",
            "as_of": "2026-04-08T00:00:00Z",
            "freshness_label": "待修复",
            "start_date": "1996-01-01",
            "end_date": "2026-04-08",
            "row_count": 0,
            "source": "mixed_sources",
            "fallback_source": "mixed_fallbacks",
            "blocker": {"code": "PRICE_SNAPSHOT_INCOMPLETE", "message": "waiting"},
            "metadata": {"missing_symbols": ["AAA", "BBB", "CCC"], "repair_cursor": 0},
        },
        price_bars=[],
        symbol_coverage=[],
    )

    refreshed = service.refresh_snapshots({"reason": "repair-batch", "mode": "repair", "targets": ["price"]})

    price_snapshot = next(item for item in refreshed["dataset_snapshots"] if item["id"] == "ds-price")
    stored_snapshot = next(item for item in repository.list_dataset_snapshots() if item["id"] == "ds-price")
    metadata = dict(stored_snapshot.get("metadata") or {})

    assert refreshed["latest_job"]["request"]["mode"] == "repair"
    assert price_snapshot["status"] == "INCOMPLETE"
    assert metadata["selection_mode"] == "repair_missing_symbols_batch"
    assert metadata["selected_missing_symbols"] == ["AAA", "BBB"]
    assert metadata["repair_priority"] == "price_only_queue"
    assert metadata["existing_price_missing_symbol_count"] == 3
    assert metadata["existing_corporate_missing_symbol_count"] == 0
    assert metadata["missing_symbols"] == ["CCC"]
    assert metadata["repair_cursor"] == 2
    assert metadata["covered_symbol_count"] == 4
    assert metadata["total_symbol_count"] == 5


def test_repair_refresh_honors_request_symbol_limit_for_single_job(tmp_path, monkeypatch):
    monkeypatch.setattr(real_service_module, "SNAPSHOT_REPAIR_SYMBOL_BATCH_SIZE", 2)
    class _Provider:
        provider_name = "repair_limit_provider"

        def fetch_history(self, symbol, start_date, end_date):
            return {
                "source": self.provider_name,
                "fallback_source": None,
                "bars": [
                    {
                        "date": "2026-04-08",
                        "open": 10.0,
                        "high": 11.0,
                        "low": 9.0,
                        "close": 10.5,
                        "adj_close": 10.5,
                        "volume": 1000,
                    }
                ],
                "actions": [],
                "warnings": [],
                "partial": False,
                "metadata": {},
            }

    service = RealBacktestPlatformService(tmp_path / "repair-limit.db", market_data_provider=_Provider())
    repository = service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "price",
            "status": "INCOMPLETE",
            "as_of": "2026-04-08T00:00:00Z",
            "freshness_label": "stale",
            "start_date": "1996-01-01",
            "end_date": "2026-04-08",
            "row_count": 0,
            "source": "mixed_sources",
            "fallback_source": "mixed_fallbacks",
            "blocker": {"code": "PRICE_SNAPSHOT_INCOMPLETE", "message": "waiting"},
            "metadata": {"missing_symbols": ["AAA", "BBB", "CCC", "DDD"], "repair_cursor": 0},
        },
        price_bars=[],
        symbol_coverage=[],
    )

    refreshed = service.refresh_snapshots(
        {
            "reason": "repair-limit",
            "mode": "repair",
            "targets": ["price"],
            "repair_symbol_limit": 3,
        }
    )

    stored_snapshot = next(item for item in repository.list_dataset_snapshots() if item["id"] == "ds-price")
    metadata = dict(stored_snapshot.get("metadata") or {})

    assert refreshed["latest_job"]["request"]["repair_symbol_limit"] == 3
    assert metadata["selected_missing_symbols"] == ["AAA", "BBB", "CCC"]
    assert metadata["repair_symbol_limit"] == 3
    assert metadata["missing_symbols"] == ["DDD"]
    assert metadata["repair_cursor"] == 3


def test_repair_refresh_symbol_limit_skips_benchmark_extra_refresh(tmp_path):
    class _Provider:
        provider_name = "bounded_repair_provider"

        def __init__(self) -> None:
            self.symbols: list[str] = []

        def fetch_history(self, symbol, start_date, end_date):
            self.symbols.append(str(symbol))
            return {
                "source": self.provider_name,
                "fallback_source": None,
                "bars": [
                    {
                        "date": "2026-04-08",
                        "open": 10.0,
                        "high": 11.0,
                        "low": 9.0,
                        "close": 10.5,
                        "adj_close": 10.5,
                        "volume": 1000,
                    }
                ],
                "actions": [],
                "warnings": [],
                "partial": False,
                "metadata": {},
            }

    provider = _Provider()
    service = RealBacktestPlatformService(tmp_path / "bounded-repair.db", market_data_provider=provider)
    repository = service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "price",
            "status": "INCOMPLETE",
            "as_of": "2026-04-08T00:00:00Z",
            "freshness_label": "stale",
            "start_date": "1996-01-01",
            "end_date": "2026-04-08",
            "row_count": 0,
            "source": "mixed_sources",
            "fallback_source": "mixed_fallbacks",
            "blocker": {"code": "PRICE_SNAPSHOT_INCOMPLETE", "message": "waiting"},
            "metadata": {"missing_symbols": ["AAA", "BBB"], "repair_cursor": 0},
        },
        price_bars=[],
        symbol_coverage=[
            CoverageSummary(symbol="SPY", start_date="1996-01-02", end_date="2026-04-08", trade_days=7600),
            CoverageSummary(symbol="QQQ", start_date="1999-03-10", end_date="2026-04-08", trade_days=6900),
        ],
    )

    service.refresh_snapshots(
        {
            "reason": "bounded-repair",
            "mode": "repair",
            "targets": ["price"],
            "repair_symbol_limit": 1,
        }
    )

    stored_snapshot = next(item for item in repository.list_dataset_snapshots() if item["id"] == "ds-price")
    metadata = dict(stored_snapshot.get("metadata") or {})

    assert provider.symbols == ["AAA"]
    assert metadata["selected_missing_symbols"] == ["AAA"]
    assert metadata["skipped_latest_extra_symbols_due_to_repair_limit"] == ["QQQ", "SPY"]


def test_repair_refresh_price_target_does_not_select_or_write_corporate_queue(tmp_path):
    class _Provider:
        provider_name = "price_target_provider"

        def __init__(self) -> None:
            self.symbols: list[str] = []

        def fetch_history(self, symbol, start_date, end_date):
            self.symbols.append(str(symbol))
            return {
                "source": self.provider_name,
                "fallback_source": None,
                "bars": [
                    {
                        "date": "2026-04-08",
                        "open": 10.0,
                        "high": 11.0,
                        "low": 9.0,
                        "close": 10.5,
                        "adj_close": 10.5,
                        "volume": 1000,
                    }
                ],
                "actions": [
                    {
                        "date": "2026-04-08",
                        "action_type": "dividend",
                        "value": 0.25,
                        "source": self.provider_name,
                    }
                ],
                "warnings": [],
                "partial": False,
                "metadata": {},
            }

    provider = _Provider()
    service = RealBacktestPlatformService(tmp_path / "price-target-repair.db", market_data_provider=provider)
    repository = service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "price",
            "status": "INCOMPLETE",
            "as_of": "2026-04-08T00:00:00Z",
            "freshness_label": "stale",
            "start_date": "1996-01-01",
            "end_date": "2026-04-08",
            "row_count": 0,
            "source": "existing_price",
            "fallback_source": None,
            "blocker": {"code": "PRICE_SNAPSHOT_INCOMPLETE", "message": "waiting"},
            "metadata": {"missing_symbols": ["PRICE"], "repair_cursor": 0},
        },
        price_bars=[],
        symbol_coverage=[],
    )
    repository.replace_dataset_snapshot(
        {
            "id": "ds-corporate-actions",
            "name": "corporate",
            "status": "INCOMPLETE",
            "as_of": "2026-04-08T00:00:00Z",
            "freshness_label": "stale",
            "start_date": "2026-04-08",
            "end_date": "2026-04-08",
            "row_count": 1,
            "source": "existing_corporate",
            "fallback_source": None,
            "blocker": {"code": "CORPORATE_ACTIONS_INCOMPLETE", "message": "waiting"},
            "metadata": {"missing_symbols": ["CORP"], "repair_cursor": 0},
        },
        corporate_actions=[
            {
                "symbol": "BASE",
                "date": "2026-04-08",
                "action_type": "dividend",
                "value": 0.1,
                "source": "existing_corporate",
                "payload": {},
            }
        ],
        symbol_coverage=[
            CoverageSummary(symbol="BASE", start_date="2026-04-08", end_date="2026-04-08", trade_days=1)
        ],
    )

    service.refresh_snapshots({"reason": "price-target-only", "mode": "repair", "targets": ["price"]})

    stored_price = next(item for item in repository.list_dataset_snapshots() if item["id"] == "ds-price")
    stored_corporate = next(item for item in repository.list_dataset_snapshots() if item["id"] == "ds-corporate-actions")
    price_metadata = dict(stored_price.get("metadata") or {})
    corporate_metadata = dict(stored_corporate.get("metadata") or {})

    assert "CORP" not in provider.symbols
    assert "SP500" not in provider.symbols
    assert "PRICE" in provider.symbols
    assert price_metadata["selected_missing_symbols"] == ["PRICE"]
    assert price_metadata["repair_priority"] == "price_only_queue"
    assert price_metadata["existing_corporate_missing_symbol_count"] == 1
    assert corporate_metadata["missing_symbols"] == ["CORP"]
    assert stored_corporate["source"] == "existing_corporate"
    assert repository.count_dataset_snapshot_rows("ds-corporate-actions")["corporate_actions"] == 1


def test_snapshot_overview_recomputes_missing_symbols_from_target_minus_coverage(tmp_path):
    service = RealBacktestPlatformService(tmp_path / "snapshot-progress-recompute.db", market_data_provider=None)
    repository = service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "?∠巨隞瑟?唳",
            "status": "INCOMPLETE",
            "as_of": "2026-04-16T00:00:00Z",
            "freshness_label": "敺耨憭?",
            "start_date": "1996-01-01",
            "end_date": "2026-04-15",
            "row_count": 1,
            "source": "yahoo",
            "fallback_source": None,
            "blocker": {"code": "PRICE_SNAPSHOT_INCOMPLETE", "message": "waiting"},
            "metadata": {
                "missing_symbols": ["AAPL", "MSFT"],
                "target_symbol_count": 2,
            },
        },
        price_bars=[
            {
                "symbol": "AAPL",
                "date": "2026-04-15",
                "open": 100.0,
                "high": 101.0,
                "low": 99.0,
                "close": 100.5,
                "adj_close": 100.5,
                "volume": 1000,
                "source": "yahoo",
                "fallback_source": None,
            }
        ],
        symbol_coverage=[CoverageSummary(symbol="AAPL", start_date="2026-04-15", end_date="2026-04-15", trade_days=1)],
    )

    overview = service.get_snapshot_overview()
    price_snapshot = next(item for item in overview["dataset_snapshots"] if item["id"] == "ds-price")

    assert price_snapshot["metadata"]["covered_symbol_count"] == 1
    assert price_snapshot["metadata"]["total_symbol_count"] == 2
    assert price_snapshot["metadata"]["missing_symbols"] == ["MSFT"]


def test_repair_refresh_with_universe_target_includes_latest_members(tmp_path, monkeypatch):
    service = RealBacktestPlatformService(tmp_path / "repair-latest.db", market_data_provider=None)
    repository = service.market_data_repository
    service._universe_history_providers = lambda: []  # type: ignore[method-assign]

    class AllSymbolsProvider:
        provider_name = "all_symbols"

        def __init__(self) -> None:
            self.calls: list[tuple[str, str, str]] = []

        def fetch_history(self, symbol, start_date, end_date):
            self.calls.append((str(symbol), start_date.isoformat(), end_date.isoformat()))
            return {
                "source": self.provider_name,
                "fallback_source": None,
                "bars": [
                    {
                        "date": "2025-05-16",
                        "open": 210.0,
                        "high": 212.0,
                        "low": 209.0,
                        "close": 211.0,
                        "adj_close": 211.0,
                        "volume": 1000,
                    }
                ],
                "actions": [
                    {
                        "date": "2025-05-16",
                        "action_type": "dividend",
                        "value": 1.0,
                    }
                ],
                "warnings": [],
                "partial": False,
                "metadata": {"mode": "test"},
            }

    provider = AllSymbolsProvider()
    service.market_data_provider = provider
    monkeypatch.setattr(service, "_latest_universe_symbols", lambda universe_snapshots: ["LATEST1", "LATEST2"])
    previous_end = date.today() - timedelta(days=1)
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "股票价格数据",
            "status": "INCOMPLETE",
            "as_of": "2026-04-08T00:00:00Z",
            "freshness_label": "待修复",
            "start_date": "1996-01-01",
            "end_date": previous_end.isoformat(),
            "row_count": 0,
            "source": "mixed_sources",
            "fallback_source": "mixed_fallbacks",
            "blocker": {"code": "PRICE_SNAPSHOT_INCOMPLETE", "message": "waiting"},
            "metadata": {"missing_symbols": ["AAA", "BBB"], "repair_cursor": 0},
        },
        price_bars=[],
        symbol_coverage=[],
    )

    refreshed = service.refresh_snapshots({"reason": "repair-latest", "mode": "repair", "targets": ["price", "corporate", "universes"]})
    price_snapshot = next(item for item in refreshed["dataset_snapshots"] if item["id"] == "ds-price")
    stored_snapshot = next(item for item in repository.list_dataset_snapshots() if item["id"] == "ds-price")
    metadata = dict(stored_snapshot.get("metadata") or {})

    assert refreshed["latest_job"]["request"]["mode"] == "repair"
    assert metadata["selection_mode"] == "repair_missing_symbols_batch_plus_latest_members"
    assert metadata["selected_latest_symbols"] == ["LATEST1", "LATEST2"]
    assert metadata["repair_priority"] == "corporate_first_unified_queue"
    assert price_snapshot["status"] == "READY"
    assert any(symbol == "AAA" and start == "1996-01-01" for symbol, start, _ in provider.calls)
    assert any(symbol == "LATEST1" and start == previous_end.isoformat() for symbol, start, _ in provider.calls)


def test_repair_refresh_promotes_missing_asset_allocation_symbols_to_full_history_queue(tmp_path):
    class AssetAllocationRepairProvider:
        provider_name = "asset_allocation_repair_provider"

        def __init__(self) -> None:
            self.calls: list[tuple[str, str, str]] = []

        def fetch_history(self, symbol, start_date, end_date):
            self.calls.append((str(symbol), start_date.isoformat(), end_date.isoformat()))
            return {
                "source": self.provider_name,
                "fallback_source": None,
                "bars": [
                    {
                        "date": end_date.isoformat(),
                        "open": 10.0,
                        "high": 11.0,
                        "low": 9.0,
                        "close": 10.5,
                        "adj_close": 10.5,
                        "volume": 1000,
                    }
                ],
                "actions": [],
                "warnings": [],
                "partial": False,
                "metadata": {},
            }

    provider = AssetAllocationRepairProvider()
    client = TestClient(create_app(tmp_path / "repair-asset-allocation.db", market_data_provider=provider))
    service = client.app.state.service
    repository = service.market_data_repository

    session = draft_strategy_session(
        client,
        strategy_type="ASSET_ALLOCATION",
        message="Create a four asset allocation model.",
        confirmation_payload={
            "revision": 1,
            "strategy_type": "ASSET_ALLOCATION",
            "core": {
                "strategy_type": "ASSET_ALLOCATION",
                "universe_name": "Global Allocation",
                "rebalance_frequency": "quarterly",
            },
            "parameters": {
                "strategy_name": "Asset allocation repair queue",
                "strategy_description": "Repair should fetch missing ETF history in full-history mode.",
                "benchmark_symbol": "SPY",
                "capital": 100000,
                "allocation_assets": [
                    {"symbol": "SPY", "display_name": "S&P 500 ETF", "asset_class": "Equity"},
                    {"symbol": "QQQ", "display_name": "Nasdaq 100 ETF", "asset_class": "Growth Equity"},
                    {"symbol": "TLT", "display_name": "20Y Treasury ETF", "asset_class": "Treasury"},
                    {"symbol": "GLD", "display_name": "Gold ETF", "asset_class": "Commodity"},
                ],
                "allocation_weight__SPY_pct": 35,
                "allocation_weight__QQQ_pct": 25,
                "allocation_weight__TLT_pct": 25,
                "allocation_weight__GLD_pct": 15,
                "investment_mode": "all_in",
                "rebalance_enabled": True,
                "rebalance_frequency": "quarterly",
                "rebalance_threshold_pct": 5,
                "cost_model_enabled": True,
                "fee_bps": 1.5,
                "slippage_bps": 2.5,
                "expense_ratio_bps": 8,
            },
        },
    )
    assert_ok(materialize_session(client, session["session_id"], idempotency_key="asset-allocation-repair-symbols"))

    previous_end = date.today() - timedelta(days=1)
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "price",
            "status": "INCOMPLETE",
            "as_of": "2026-04-08T00:00:00Z",
            "freshness_label": "stale",
            "start_date": "1996-01-01",
            "end_date": previous_end.isoformat(),
            "row_count": 2,
            "source": "mixed_sources",
            "fallback_source": "mixed_fallbacks",
            "blocker": {"code": "PRICE_SNAPSHOT_INCOMPLETE", "message": "waiting"},
            "metadata": {"missing_symbols": ["AAA"], "repair_cursor": 0},
        },
        price_bars=[
            {
                "symbol": "SPY",
                "date": previous_end.isoformat(),
                "open": 500.0,
                "high": 501.0,
                "low": 499.0,
                "close": 500.0,
                "adj_close": 500.0,
                "volume": 1_000_000,
                "source": "seed",
            },
            {
                "symbol": "QQQ",
                "date": previous_end.isoformat(),
                "open": 400.0,
                "high": 401.0,
                "low": 399.0,
                "close": 400.0,
                "adj_close": 400.0,
                "volume": 1_000_000,
                "source": "seed",
            },
        ],
        symbol_coverage=[
            {
                "symbol": "SPY",
                "start_date": "1996-01-02",
                "end_date": previous_end.isoformat(),
                "trade_days": 7500,
                "source": "seed",
            },
            {
                "symbol": "QQQ",
                "start_date": "1999-03-10",
                "end_date": previous_end.isoformat(),
                "trade_days": 6800,
                "source": "seed",
            },
        ],
    )

    refreshed = service.refresh_snapshots({"reason": "repair-asset-allocation", "mode": "repair", "targets": ["price"]})
    stored_snapshot = next(item for item in repository.list_dataset_snapshots() if item["id"] == "ds-price")
    metadata = dict(stored_snapshot.get("metadata") or {})

    assert refreshed["latest_job"]["request"]["mode"] == "repair"
    assert metadata["selected_missing_symbols"] == ["AAA"]
    assert metadata["selected_required_strategy_symbols"] == ["GLD", "TLT"]
    assert any(symbol == "AAA" and start == "1996-01-01" for symbol, start, _ in provider.calls)
    assert any(symbol == "TLT" and start == "1996-01-01" for symbol, start, _ in provider.calls)
    assert any(symbol == "GLD" and start == "1996-01-01" for symbol, start, _ in provider.calls)
    assert any(symbol == "SPY" and start == previous_end.isoformat() for symbol, start, _ in provider.calls)
    assert any(symbol == "QQQ" and start == previous_end.isoformat() for symbol, start, _ in provider.calls)


def test_snapshot_memory_guard_uses_python_process_limit_not_busy_system_alone(tmp_path, monkeypatch):
    service = RealBacktestPlatformService(tmp_path / "memory-guard.db", market_data_provider=None)
    monkeypatch.setattr(
        service,
        "_snapshot_memory_status",
        lambda: {
            "total_physical_bytes": float(64 * 1024 * 1024 * 1024),
            "available_physical_bytes": float(11 * 1024 * 1024 * 1024),
            "process_working_set_bytes": float(512 * 1024 * 1024 * 1024),
            "system_memory_ratio": 0.82,
            "process_memory_ratio": 0.01,
        },
    )

    service._raise_if_snapshot_memory_limit_exceeded(stage="unit-test")


def test_snapshot_memory_guard_still_stops_extreme_system_pressure(tmp_path, monkeypatch):
    service = RealBacktestPlatformService(tmp_path / "memory-guard-emergency.db", market_data_provider=None)
    monkeypatch.setattr(
        service,
        "_snapshot_memory_status",
        lambda: {
            "total_physical_bytes": float(64 * 1024 * 1024 * 1024),
            "available_physical_bytes": float(1 * 1024 * 1024 * 1024),
            "process_working_set_bytes": float(512 * 1024 * 1024 * 1024),
            "system_memory_ratio": 0.97,
            "process_memory_ratio": 0.01,
        },
    )

    try:
        service._raise_if_snapshot_memory_limit_exceeded(stage="unit-test")
    except real_service_module.SnapshotMemoryPressureError as exc:
        assert "limit=80%" in str(exc)
    else:
        raise AssertionError("Expected memory guard to stop refresh under emergency system pressure")


def test_refresh_snapshots_preserves_existing_corporate_actions_when_live_fetch_returns_none(tmp_path):
    class NoActionsProvider:
        provider_name = "no_actions"

        def fetch_history(self, symbol, start_date, end_date):
            return {
                "source": self.provider_name,
                "fallback_source": None,
                "bars": [
                    {
                        "date": "2025-05-16",
                        "open": 210.0,
                        "high": 212.0,
                        "low": 209.0,
                        "close": 211.0,
                        "adj_close": 211.0,
                        "volume": 1000,
                    },
                    {
                        "date": "2025-05-19",
                        "open": 211.0,
                        "high": 213.0,
                        "low": 210.5,
                        "close": 212.0,
                        "adj_close": 212.0,
                        "volume": 1100,
                    },
                ],
                "actions": [],
                "warnings": [],
                "partial": False,
                "metadata": {"mode": "test"},
            }

    service = RealBacktestPlatformService(tmp_path / "preserve-actions.db", market_data_provider=NoActionsProvider())
    service._universe_history_providers = lambda: []  # type: ignore[method-assign]
    repository = service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-corporate-actions",
            "name": "公司行为数据",
            "status": "STALE",
            "as_of": "2026-04-01T08:00:00Z",
            "freshness_label": "已从本地缓存恢复",
            "start_date": "2025-05-16",
            "end_date": "2025-05-19",
            "row_count": 1,
            "source": "legacy_local_cache",
            "fallback_source": "live_refresh_pending",
            "blocker": {"code": "LIVE_REFRESH_PENDING", "message": "waiting"},
            "metadata": {},
        },
        corporate_actions=[
            {
                "symbol": "AAPL",
                "date": "2025-05-19",
                "action_type": "dividend",
                "value": 1.0,
                "source": "legacy_local_cache",
                "fallback_source": "live_refresh_pending",
                "payload": {"cash": 1.0},
            }
        ],
    )

    refreshed = service.refresh_snapshots({"reason": "preserve-existing-actions"})
    actions_snapshot = next(item for item in refreshed["dataset_snapshots"] if item["id"] == "ds-corporate-actions")

    assert actions_snapshot["row_count"] == 1
    assert actions_snapshot["status"] == "STALE"
    assert actions_snapshot["freshness_label"] == "继续使用已有快照"


def test_main_refresh_snapshots_cli_uses_service_and_preserves_default_server_path(monkeypatch, tmp_path, capsys):
    from grit_backtest_platform import main as main_module

    refresh_calls: list[dict[str, Any]] = []
    server_calls: list[dict[str, Any]] = []

    class StubService:
        def __init__(self, database_path, market_data_provider=None, market_data_path=None):
            self.database_path = database_path

        def refresh_snapshots(self, payload):
            refresh_calls.append(dict(payload))
            return {"overall_status": "READY", "latest_job": {"request": dict(payload)}}

    def fake_run(app, host, port):
        server_calls.append({"app": app, "host": host, "port": port})

    monkeypatch.setattr(main_module, "RealBacktestPlatformService", StubService)
    monkeypatch.setattr(main_module.uvicorn, "run", fake_run)

    main_module.main(
        [
            "refresh-snapshots",
            "--reason",
            "scheduled-18hkt",
            "--mode",
            "repair",
            "--targets",
            "price,corporate,universes",
            "--db-path",
            str(tmp_path / "cli.db"),
        ]
    )
    printed = capsys.readouterr().out.strip()
    cli_payload = json.loads(printed)

    assert refresh_calls == [
        {
            "reason": "scheduled-18hkt",
            "mode": "repair",
            "targets": ["price", "corporate", "universes"],
        }
    ]
    assert cli_payload["latest_job"]["request"]["reason"] == "scheduled-18hkt"
    assert cli_payload["latest_job"]["request"]["mode"] == "repair"
    assert cli_payload["latest_job"]["request"]["targets"] == ["price", "corporate", "universes"]
    assert server_calls == []

    main_module.main([])
    assert server_calls and server_calls[0]["port"] == 8000


def test_creation_session_workflow_materializes_and_lists_strategy(tmp_path):
    client, _ = create_test_client(tmp_path)

    session = draft_strategy_session(
        client,
        strategy_type="MOMENTUM",
        message="momentum strategy for SPY",
        confirmation_payload=momentum_confirmation_payload(revision=1),
    )

    assert session["created"]["mode"] == "CREATE"
    assert session["hydrated"]["messages"][-1]["content"] == "momentum strategy for SPY"
    assert session["prepared"]["status"] == "NEEDS_INPUT"
    assert session["confirmed"]["revision"] == session["prepared"]["revision"] + 1

    materialized = assert_ok(
        materialize_session(
            client,
            session["session_id"],
            idempotency_key="materialize-workflow-1",
        )
    )
    strategy_id = materialized["id"]

    strategies = assert_ok(client.get("/strategies"))
    detail = assert_ok(client.get(f"/strategies/{strategy_id}/detail"))
    overview = assert_ok(client.get("/workspace/overview"))

    assert len(strategies) == 1
    assert strategies[0]["id"] == strategy_id
    assert detail["current_parameter_version"] == 1
    assert detail["parameter_history"][0]["parameter_version_id"] == detail["current_parameter_version_id"]
    assert detail["parameters"]["top_n"] == 1
    assert_workspace_overview_contract(overview)
    assert overview["latest_strategy_id"] == strategy_id


def _assert_parameter_history_metadata_defaults(entry: dict[str, Any], *, rollbackable: bool) -> None:
    assert isinstance(entry["change_summary"], str)
    assert entry["change_summary"].strip()
    assert entry["decision_note"] in (None, "")
    assert isinstance(entry["source"], dict)
    assert str(entry["source"].get("kind") or "").strip()
    assert entry["source"]["kind"] not in {"optimization_promotion", "version_restore"}
    assert entry["alternative_versions"] == []
    assert entry["rollbackable"] is rollbackable


def test_parameter_history_metadata_defaults_for_basic_and_legacy_strategies(tmp_path):
    client, _ = create_test_client(tmp_path)

    materialized = create_momentum_strategy(client, idempotency_key="parameter-metadata-basic")["strategy"]
    detail = assert_ok(client.get(f"/strategies/{materialized['id']}/detail"))
    current_entry = detail["parameter_history"][-1]

    assert current_entry["parameter_version_id"] == detail["current_parameter_version_id"]
    _assert_parameter_history_metadata_defaults(current_entry, rollbackable=False)

    service = client.app.state.service
    now = "2026-04-28T10:00:00Z"
    legacy_strategy_id = "strat_legacy_parameter_metadata"
    legacy_parameters = {
        "strategy_name": "Legacy SPY Momentum",
        "strategy_description": "Restored from an older strategy row.",
        "benchmark_symbol": "SPY",
        "lookback_months": 6,
        "skip_recent_months": 1,
        "top_n": 2,
        "hold_rank_threshold": 3,
    }
    legacy_parameter_version_id = f"{legacy_strategy_id}-v1"
    service.storage.insert_json_row(
        "strategies",
        {
            "id": legacy_strategy_id,
            "name": legacy_parameters["strategy_name"],
            "description": legacy_parameters["strategy_description"],
            "strategy_type": "MOMENTUM",
            "universe_name": "SPY",
            "rebalance_frequency": "monthly",
            "lifecycle_status": "ACTIVE",
            "dataset_snapshot_id": "ds-price",
            "universe_snapshot_id": "un-sp500",
            "benchmark_symbol": "SPY",
            "current_parameter_version": 1,
            "parameters_json": json.dumps(legacy_parameters),
            "confirmation_fields_json": "{}",
            "parameter_history_json": json.dumps(
                [
                    {
                        "version_number": 1,
                        "parameter_version_id": legacy_parameter_version_id,
                        "revision": 1,
                        "created_at": now,
                        "parameters": legacy_parameters,
                    }
                ]
            ),
            "allowed_actions_json": "[]",
            "created_at": now,
            "updated_at": now,
        },
    )

    legacy_detail = assert_ok(client.get(f"/strategies/{legacy_strategy_id}/detail"))
    legacy_entry = legacy_detail["parameter_history"][0]

    assert legacy_detail["current_parameter_version_id"] == legacy_parameter_version_id
    assert legacy_entry["parameters"] == legacy_parameters
    _assert_parameter_history_metadata_defaults(legacy_entry, rollbackable=False)


def test_parameter_history_summaries_rebuild_from_adjacent_versions_and_persist(tmp_path):
    client, _ = create_test_client(tmp_path)

    service = client.app.state.service
    strategy_id = "strat_parameter_summary_backfill"
    now = "2026-04-28T10:00:00Z"
    base_parameters = {
        "strategy_name": "Backfill Momentum",
        "strategy_description": "Backfill parameter history summaries.",
        "benchmark_symbol": "SPY",
        "lookback_months": 6,
        "skip_recent_months": 1,
        "top_n": 2,
        "hold_rank_threshold": 3,
        "strategy_type": "MOMENTUM",
        "universe_name": "SPY",
        "rebalance_frequency": "monthly",
    }
    history = [
        {
            "version_number": 1,
            "parameter_version_id": f"{strategy_id}-v1",
            "revision": 1,
            "created_at": now,
            "parameters": base_parameters,
            "change_summary": "stale imported copy",
        },
        {
            "version_number": 2,
            "parameter_version_id": f"{strategy_id}-v2",
            "revision": 2,
            "created_at": now,
            "parameters": {**base_parameters, "top_n": 5},
            "change_summary": "",
            "comment": "manual revision",
        },
        {
            "version_number": 3,
            "parameter_version_id": f"{strategy_id}-v3",
            "revision": 3,
            "created_at": now,
            "parameters": {**base_parameters, "lookback_months": 12, "top_n": 8, "hold_rank_threshold": 12},
        },
    ]
    service.storage.insert_json_row(
        "strategies",
        {
            "id": strategy_id,
            "name": base_parameters["strategy_name"],
            "description": base_parameters["strategy_description"],
            "strategy_type": "MOMENTUM",
            "universe_name": "SPY",
            "rebalance_frequency": "monthly",
            "lifecycle_status": "ACTIVE",
            "dataset_snapshot_id": "ds-price",
            "universe_snapshot_id": "un-sp500",
            "benchmark_symbol": "SPY",
            "current_parameter_version": 3,
            "parameters_json": json.dumps(history[-1]["parameters"]),
            "confirmation_fields_json": "{}",
            "parameter_history_json": json.dumps(history),
            "allowed_actions_json": "[]",
            "created_at": now,
            "updated_at": now,
        },
    )

    detail = assert_ok(client.get(f"/strategies/{strategy_id}/detail"))
    summaries = [entry["change_summary"] for entry in detail["parameter_history"]]

    assert summaries == [
        "初始版本记录",
        "买入排名阈值 2→5",
        "回看(月) 6→12\n买入排名阈值 5→8\n保留排名阈值 3→12",
    ]
    assert detail["parameter_history"][1]["decision_note"] == "manual revision"
    assert detail["parameter_history"][1]["source"] == {"kind": "legacy"}
    assert detail["parameter_history"][1]["rollbackable"] is True
    assert detail["parameter_history"][2]["rollbackable"] is False

    version_rows = service._strategy_parameter_version_rows(strategy_id)
    assert [row["change_summary"] for row in version_rows] == summaries
    persisted_strategy = service.storage.fetch_one(
        "SELECT parameter_history_json FROM strategies WHERE id = ?",
        (strategy_id,),
    )
    assert persisted_strategy is not None
    persisted_history = json.loads(persisted_strategy["parameter_history_json"])
    assert [entry["change_summary"] for entry in persisted_history] == summaries


def test_revision_materialize_appends_parameter_version_without_creating_new_strategy(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-1")
    base_strategy = base["strategy"]
    strategy_count_before = len(assert_ok(client.get("/strategies")))
    base_parameter_version_id = base_strategy["current_parameter_version_id"]

    revision_session = draft_strategy_session(
        client,
        strategy_type="MOMENTUM",
        message="momentum strategy revision for SPY",
        confirmation_payload=momentum_confirmation_payload(revision=1, top_n=3),
        mode="REVISION",
        base_strategy_id=base_strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )

    assert revision_session["created"]["mode"] == "REVISION"
    assert revision_session["hydrated"]["base_strategy_id"] == base_strategy["id"]
    assert revision_session["hydrated"]["base_parameter_version_id"] == base_parameter_version_id

    revised = assert_ok(
        materialize_session(
            client,
            revision_session["session_id"],
            idempotency_key="materialize-revision-1",
            base_parameter_version_id=base_parameter_version_id,
        )
    )
    strategies = assert_ok(client.get("/strategies"))

    assert revised["id"] == base_strategy["id"]
    assert len(strategies) == strategy_count_before
    assert revised["current_parameter_version"] == 2
    assert revised["current_parameter_version_id"] != base_parameter_version_id
    assert len(revised["parameter_history"]) == 2
    assert revised["parameter_history"][-1]["parameters"]["top_n"] == 3


def test_revision_materialize_rejects_stale_base_parameter_version(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-stale")
    base_strategy = base["strategy"]
    stale_base_parameter_version_id = base_strategy["current_parameter_version_id"]

    stale_session = draft_strategy_session(
        client,
        strategy_type="MOMENTUM",
        message="momentum stale revision for SPY",
        confirmation_payload=momentum_confirmation_payload(revision=1, top_n=2),
        mode="REVISION",
        base_strategy_id=base_strategy["id"],
        base_parameter_version_id=stale_base_parameter_version_id,
    )
    fresh_revision = create_momentum_strategy(
        client,
        mode="REVISION",
        base_strategy_id=base_strategy["id"],
        base_parameter_version_id=stale_base_parameter_version_id,
        top_n=4,
        idempotency_key="materialize-fresh-revision",
    )

    response = materialize_session(
        client,
        stale_session["session_id"],
        idempotency_key="materialize-stale-revision",
        base_parameter_version_id=stale_base_parameter_version_id,
    )

    assert response.status_code == 409
    payload = response.json()
    assert payload["code"] == "stale_base_parameter_version"
    assert payload["expected_base_parameter_version_id"] == stale_base_parameter_version_id
    assert payload["current_parameter_version_id"] == fresh_revision["strategy"]["current_parameter_version_id"]


def test_restore_parameter_version_creates_current_version_with_metadata(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="restore-version-base", top_n=2)
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    revised = create_momentum_strategy(
        client,
        mode="REVISION",
        base_strategy_id=strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
        top_n=5,
        idempotency_key="restore-version-revision",
    )["strategy"]
    before_restore = assert_ok(client.get(f"/strategies/{strategy['id']}/detail"))
    source_entry = before_restore["parameter_history"][0]
    revised_entry = before_restore["parameter_history"][-1]
    decision_note = "Restore the original top_n after review."

    restored = assert_ok(
        client.post(
            f"/strategies/{strategy['id']}/parameter-versions/{source_entry['parameter_version_id']}/restore",
            json={
                "idempotency_key": "restore-version-current-1",
                "base_parameter_version_id": revised["current_parameter_version_id"],
                "decision_note": decision_note,
            },
        )
    )

    restored_history = restored["parameter_history"]
    restored_entry = restored_history[-1]
    restored_history_ids = {entry["parameter_version_id"] for entry in restored_history}

    assert restored["current_parameter_version"] == revised["current_parameter_version"] + 1
    assert restored["current_parameter_version_id"] == restored_entry["parameter_version_id"]
    assert restored["current_parameter_version_id"] not in {
        source_entry["parameter_version_id"],
        revised_entry["parameter_version_id"],
    }
    assert restored["parameters"] == source_entry["parameters"]
    assert source_entry["parameter_version_id"] in restored_history_ids
    assert revised_entry["parameter_version_id"] in restored_history_ids
    assert len(restored_history) == len(before_restore["parameter_history"]) + 1
    assert restored_entry["parameters"] == source_entry["parameters"]
    assert restored_entry["decision_note"] == decision_note
    assert isinstance(restored_entry["change_summary"], str)
    assert restored_entry["change_summary"].strip()
    assert restored_entry["change_summary"] != decision_note
    assert restored_entry["source"]["kind"] == "version_restore"
    assert restored_entry["source"]["source_parameter_version_id"] == source_entry["parameter_version_id"]
    assert restored_entry["rollbackable"] is False


def test_restore_parameter_version_rejects_stale_base_parameter_version(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="restore-version-stale-base", top_n=2)
    strategy = base["strategy"]
    stale_base_parameter_version_id = strategy["current_parameter_version_id"]
    revised = create_momentum_strategy(
        client,
        mode="REVISION",
        base_strategy_id=strategy["id"],
        base_parameter_version_id=stale_base_parameter_version_id,
        top_n=6,
        idempotency_key="restore-version-stale-revision",
    )["strategy"]

    response = client.post(
        f"/strategies/{strategy['id']}/parameter-versions/{stale_base_parameter_version_id}/restore",
        json={
            "idempotency_key": "restore-version-stale-1",
            "base_parameter_version_id": stale_base_parameter_version_id,
            "decision_note": "Attempt restore from a stale detail view.",
        },
    )

    assert response.status_code == 409
    payload = response.json()
    assert payload["code"] == "stale_base_parameter_version"
    assert payload["expected_base_parameter_version_id"] == stale_base_parameter_version_id
    assert payload["current_parameter_version_id"] == revised["current_parameter_version_id"]


def test_promote_trial_rejects_stale_base_parameter_version(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-promote")
    strategy = base["strategy"]
    stale_base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=stale_base_parameter_version_id,
    )
    trial_id = job["candidates"][0]["id"]

    create_momentum_strategy(
        client,
        mode="REVISION",
        base_strategy_id=strategy["id"],
        base_parameter_version_id=stale_base_parameter_version_id,
        top_n=5,
        idempotency_key="materialize-promote-conflict",
    )

    response = client.post(
        f"/optimization-jobs/{job['id']}/candidates/{trial_id}/promote",
        json={
            "idempotency_key": "promote-stale-1",
            "mode": "set_current",
            "base_parameter_version_id": stale_base_parameter_version_id,
        },
    )

    assert response.status_code == 409
    payload = response.json()
    assert payload["code"] == "stale_base_parameter_version"
    assert payload["expected_base_parameter_version_id"] == stale_base_parameter_version_id


def test_list_optimization_jobs_returns_latest_first_with_projection_fields(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-optimization-list")
    strategy = base["strategy"]
    first_search_space = [
        {"key": "lookback_months", "label": "观察周期", "mode": "range", "start": 5, "end": 6, "step": 1, "current": 6},
        {"key": "top_n", "label": "持仓数量", "mode": "range", "start": 3, "end": 4, "step": 1, "current": 4},
    ]
    second_search_space = [
        {"key": "lookback_months", "label": "观察周期", "mode": "range", "start": 4, "end": 6, "step": 1, "current": 6},
        {"key": "top_n", "label": "持仓数量", "mode": "range", "start": 3, "end": 4, "step": 1, "current": 4},
    ]
    first_job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        entry_point="lab_menu",
        validation_mode="walk_forward",
        budget_combinations=4,
        search_space=first_search_space,
    )
    second_job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        entry_point="run_detail",
        source_run_id=strategy["latest_successful_run_id"],
        validation_mode="single_oos",
        budget_combinations=6,
        search_space=second_search_space,
    )

    jobs = assert_ok(client.get("/optimization-jobs"))

    assert [item["id"] for item in jobs[:2]] == [second_job["id"], first_job["id"]]
    assert jobs[0]["strategy_name"] == strategy["name"]
    assert jobs[0]["entry_point"] == "run_detail"
    assert jobs[0]["source_run_id"] == strategy["latest_successful_run_id"]
    assert jobs[0]["budget_combinations"] == 6
    assert jobs[0]["completed_combinations"] == 6
    assert jobs[0]["status"] == "COMPLETED"
    assert jobs[0]["best_candidate_id"] is not None
    assert jobs[0]["best_candidate_label"] is not None
    assert jobs[0]["progress_pct"] == 100
    assert jobs[0]["resume_ready"] is False
    assert jobs[0]["next_trial_index"] == 7
    assert jobs[0]["estimated_remaining_minutes"] == 0
    assert jobs[0]["estimated_completed_at"] is not None
    assert jobs[0]["best_metrics_summary"]["status"] == "SUCCEEDED"
    assert jobs[1]["progress_pct"] == 100
    assert jobs[1]["estimated_remaining_minutes"] == 0
    assert jobs[1]["estimated_completed_at"] is not None


def test_create_optimization_job_round_trips_constraint_contract_fields(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="optimization-constraint-contract")
    strategy = base["strategy"]
    constraints = [
        {
            "key": "max_drawdown_pct",
            "label": "Max drawdown",
            "category": "risk",
            "operator": "<=",
            "value": 18,
            "unit": "%",
        },
        {
            "key": "return_sharpe",
            "label": "Return Sharpe",
            "category": "performance",
            "operator": ">=",
            "value": 1.1,
            "unit": "score",
        },
    ]

    job = assert_ok(
        client.post(
            f"/strategies/{strategy['id']}/optimization-jobs",
            json={
                "objective": "return_sharpe",
                "base_parameter_version_id": strategy["current_parameter_version_id"],
                "entry_point": "lab_menu",
                "validation_mode": "walk_forward",
                "budget_combinations": 4,
                "search_space": [
                    {"key": "lookback_months", "label": "Lookback", "mode": "range", "start": 5, "end": 6, "step": 1, "current": 6},
                    {"key": "top_n", "label": "Top N", "mode": "range", "start": 3, "end": 4, "step": 1, "current": 4},
                ],
                "constraint_preset_key": "offensive",
                "constraint_label": "Offensive guardrails",
                "constraints": constraints,
            },
        )
    )

    assert job["constraint_preset_key"] == "offensive"
    assert job["constraint_label"] == "Offensive guardrails"
    assert job["constraints"] == constraints
    assert job["request"]["objective"] == "return_sharpe"
    assert job["request"]["constraint_preset_key"] == "offensive"
    assert job["request"]["constraint_label"] == "Offensive guardrails"
    assert job["request"]["constraints"] == constraints
    assert job["summary"]["objective"] == "return_sharpe"
    assert job["summary"]["constraint_preset_key"] == "offensive"
    assert job["summary"]["constraint_label"] == "Offensive guardrails"
    assert job["summary"]["constraints"] == constraints
    assert job["result"]["constraint_preset_key"] == "offensive"
    assert job["result"]["constraint_label"] == "Offensive guardrails"
    assert job["result"]["constraints"] == constraints

    detail = assert_ok(client.get(f"/optimization-jobs/{job['id']}/detail"))
    assert detail["constraint_preset_key"] == "offensive"
    assert detail["constraint_label"] == "Offensive guardrails"
    assert detail["constraints"] == constraints
    assert detail["request"]["objective"] == "return_sharpe"
    assert detail["summary"]["objective"] == "return_sharpe"
    assert detail["summary"]["constraint_preset_key"] == "offensive"
    assert detail["result"]["constraint_preset_key"] == "offensive"


def _test_patch_optimization_job_constraints_persists_updated_filters_without_losing_existing_results_smoke(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="optimization-patch-constraint")
    strategy = base["strategy"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
    )
    updated_constraints = [
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 15,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.8,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 8,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 70,
            "unit": "pts",
        },
        {
            "key": "turnover",
            "label": "换手率",
            "category": "risk",
            "operator": "<=",
            "value": 12,
            "unit": "%",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 1.0,
            "unit": "",
        },
    ]

    updated_constraints = [
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 25,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.8,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 8,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 70,
            "unit": "pts",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 1.0,
            "unit": "",
        },
    ]

    updated = assert_ok(
        client.patch(
            f"/optimization-jobs/{job['id']}",
            json={
                "objective": "annualized_return",
                "constraint_preset_key": "defensive",
                "constraint_label": "稳健型（自定义）",
                "constraints": updated_constraints,
            },
        )
    )

    assert updated["request"]["objective"] == "annualized_return"
    assert updated["request"]["constraint_preset_key"] == "defensive"
    assert updated["request"]["constraint_label"] == "稳健型（自定义）"
    assert updated["request"]["constraints"] == updated_constraints
    assert updated["summary"]["objective"] == "annualized_return"
    assert updated["summary"]["constraint_preset_key"] == "defensive"
    assert updated["summary"]["constraint_label"] == "稳健型（自定义）"
    assert updated["summary"]["constraints"] == updated_constraints
    assert updated["result"]["constraint_preset_key"] == "defensive"
    assert updated["result"]["constraint_label"] == "稳健型（自定义）"
    assert updated["result"]["constraints"] == updated_constraints
    assert len(updated["candidates"]) == len(job["candidates"])
    assert updated["result"]["best_candidate_id"] == job["result"]["best_candidate_id"]
    assert updated["summary"]["latest_update"] == job["summary"]["latest_update"]
    assert updated["summary"]["best_metrics_summary"] == job["summary"]["best_metrics_summary"]

    refreshed = assert_ok(client.get(f"/optimization-jobs/{job['id']}/detail"))
    assert refreshed["summary"]["constraints"] == updated_constraints
    assert refreshed["result"]["constraints"] == updated_constraints
    assert refreshed["candidates"] == updated["candidates"]


def _test_patch_optimization_job_constraints_persists_updated_filters_without_losing_existing_results(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    base = create_momentum_strategy(client, idempotency_key="optimization-patch-constraint")
    strategy = base["strategy"]
    job_id = "opt_patch_constraint_refresh"
    created_at = "2026-04-13T10:00:00Z"
    request_payload = {
        "objective": "return_sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": 5,
        "search_space": [
            {"key": "lookback_months", "label": "Lookback", "mode": "range", "start": 6, "end": 7, "step": 1, "current": 6},
            {
                "key": "hold_rank_threshold",
                "label": "Hold Rank",
                "mode": "range",
                "start": 120,
                "end": 160,
                "step": 10,
                "current": 120,
            },
        ],
        "status": "COMPLETED",
        "progress_pct": 100,
        "completed_combinations": 5,
        "persisted_trial_count": 5,
        "next_trial_index": 6,
        "current_stage": "Result ready",
        "latest_update": "Optimization completed.",
    }

    def build_trial(
        *,
        trial_index: int,
        snapshot: dict[str, Any],
        score: float,
        annualized_return: float,
        return_sharpe: float,
        out_of_sample_sharpe: float,
        max_drawdown_pct: float,
        stability: float,
        total_return_pct: float,
        turnover: float = 0.08,
    ) -> dict[str, Any]:
        metrics = {
            "total_return": total_return_pct / 100.0,
            "total_return_pct": total_return_pct,
            "cagr": annualized_return,
            "annualized_return": annualized_return,
            "annualized_volatility": 0.18,
            "sharpe": return_sharpe,
            "return_sharpe": return_sharpe,
            "oos_cagr": annualized_return * 0.9,
            "oos_sharpe": out_of_sample_sharpe,
            "out_of_sample_sharpe": out_of_sample_sharpe,
            "max_drawdown": max_drawdown_pct / 100.0,
            "max_drawdown_pct": max_drawdown_pct,
            "turnover": turnover,
            "win_rate": 0.58,
            "stability": stability,
        }
        return {
            "trial_index": trial_index,
            "parameter_snapshot": snapshot,
            "metrics": metrics,
            "chart_series": [
                {
                    "trade_date": f"2026-01-0{offset + 1}",
                    "equity": 100.0 + trial_index + offset,
                    "benchmark": 100.0,
                    "drawdown": max_drawdown_pct if offset == 1 else 0.0,
                    "is_oos": offset >= 2,
                    "strategy_return": 0.01,
                    "benchmark_return": 0.005,
                }
                for offset in range(4)
            ],
            "score": score,
        }

    base_snapshot = dict(strategy.get("parameters") or {})
    trial_rows = [
        build_trial(
            trial_index=1,
            snapshot={**base_snapshot, "lookback_months": 6, "hold_rank_threshold": 120},
            score=98.0,
            annualized_return=0.11,
            return_sharpe=1.25,
            out_of_sample_sharpe=0.78,
            max_drawdown_pct=-38.0,
            stability=62.0,
            total_return_pct=65.0,
        ),
        build_trial(
            trial_index=2,
            snapshot={**base_snapshot, "lookback_months": 6, "hold_rank_threshold": 130},
            score=97.5,
            annualized_return=0.11,
            return_sharpe=1.25,
            out_of_sample_sharpe=0.78,
            max_drawdown_pct=-38.0,
            stability=62.0,
            total_return_pct=65.0,
        ),
        build_trial(
            trial_index=3,
            snapshot={**base_snapshot, "lookback_months": 6, "hold_rank_threshold": 140},
            score=94.0,
            annualized_return=0.10,
            return_sharpe=1.10,
            out_of_sample_sharpe=0.92,
            max_drawdown_pct=-18.0,
            stability=79.0,
            total_return_pct=35.0,
        ),
        build_trial(
            trial_index=4,
            snapshot={**base_snapshot, "lookback_months": 7, "hold_rank_threshold": 150},
            score=93.2,
            annualized_return=0.095,
            return_sharpe=1.05,
            out_of_sample_sharpe=0.88,
            max_drawdown_pct=-21.0,
            stability=76.0,
            total_return_pct=33.0,
        ),
        build_trial(
            trial_index=5,
            snapshot={**base_snapshot, "lookback_months": 7, "hold_rank_threshold": 160},
            score=91.0,
            annualized_return=0.085,
            return_sharpe=0.92,
            out_of_sample_sharpe=0.75,
            max_drawdown_pct=-28.0,
            stability=68.0,
            total_return_pct=31.0,
        ),
    ]
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        request_payload,
        [],
        created_at=created_at,
        updated_at=created_at,
        completed_at=created_at,
    )
    for trial in trial_rows:
        service._persist_optimization_trial(
            job_id,
            trial["trial_index"],
            status="SUCCEEDED",
            parameter_snapshot=trial["parameter_snapshot"],
            metrics=trial["metrics"],
            chart_series=trial["chart_series"],
            score=trial["score"],
            error_message=None,
            started_at=created_at,
            completed_at=created_at,
        )

    stale_candidates = [
        service._build_candidate_record(
            strategy=strategy,
            parameter_snapshot=trial_rows[0]["parameter_snapshot"],
            base_parameter_version_id=strategy["current_parameter_version_id"],
            label="候选 1",
            title="Best candidate",
            status_label=service._optimization_status_label(trial_rows[0]["metrics"]),
            metrics=trial_rows[0]["metrics"],
            summary="stale duplicate",
            rank=1,
            score=trial_rows[0]["score"],
            analysis={},
        ),
        service._build_candidate_record(
            strategy=strategy,
            parameter_snapshot=trial_rows[1]["parameter_snapshot"],
            base_parameter_version_id=strategy["current_parameter_version_id"],
            label="候选 2",
            title="Candidate 2",
            status_label=service._optimization_status_label(trial_rows[1]["metrics"]),
            metrics=trial_rows[1]["metrics"],
            summary="stale duplicate",
            rank=2,
            score=trial_rows[1]["score"],
            analysis={},
        ),
    ]
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        {
            **request_payload,
            "best_metrics_summary": service._best_optimization_trial_summary([trial_rows[0], trial_rows[1]]),
        },
        stale_candidates,
        created_at=created_at,
        updated_at=created_at,
        completed_at=created_at,
    )

    updated_constraints = [
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 25,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.8,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 8,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 70,
            "unit": "pts",
        },
        {
            "key": "turnover",
            "label": "换手率",
            "category": "risk",
            "operator": "<=",
            "value": 12,
            "unit": "%",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 1.0,
            "unit": "",
        },
    ]

    updated_constraints = [
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 25,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.8,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 8,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 70,
            "unit": "pts",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 1.0,
            "unit": "",
        },
    ]

    updated = assert_ok(
        client.patch(
            f"/optimization-jobs/{job_id}",
            json={
                "constraint_preset_key": "defensive",
                "constraint_label": "蝔喳???芸?銋?",
                "constraints": updated_constraints,
            },
        )
    )

    assert updated["request"]["constraint_preset_key"] == "defensive"
    assert updated["request"]["constraint_label"] == "蝔喳???芸?銋?"
    assert updated["request"]["constraints"] == updated_constraints
    assert updated["summary"]["constraint_preset_key"] == "defensive"
    assert updated["summary"]["constraint_label"] == "蝔喳???芸?銋?"
    assert updated["summary"]["constraints"] == updated_constraints
    assert updated["result"]["constraint_preset_key"] == "defensive"
    assert updated["result"]["constraint_label"] == "蝔喳???芸?銋?"
    assert updated["result"]["constraints"] == updated_constraints
    assert len(updated["candidates"]) >= 2
    assert updated["candidates"][0]["parameter_snapshot"]["hold_rank_threshold"] == 140
    assert updated["candidates"][1]["parameter_snapshot"]["hold_rank_threshold"] == 150
    assert updated["result"]["best_candidate_id"] == updated["candidates"][0]["id"]
    assert updated["result"]["best_candidate_label"] == updated["candidates"][0]["label"]
    assert updated["summary"]["best_metrics_summary"]["label"] == updated["candidates"][0]["label"]
    assert updated["candidates"][0]["metrics"]["max_drawdown_pct"] >= -25.0
    assert updated["candidates"][0]["metrics"]["out_of_sample_sharpe"] >= 0.8
    assert updated["candidates"][1]["metrics"]["max_drawdown_pct"] >= -25.0
    assert updated["candidates"][1]["metrics"]["out_of_sample_sharpe"] >= 0.8
    assert (
        updated["candidates"][0]["metrics"]["annualized_return"]
        >= updated["candidates"][1]["metrics"]["annualized_return"]
    )

    refreshed = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail"))
    assert refreshed["summary"]["constraints"] == updated_constraints
    assert refreshed["result"]["constraints"] == updated_constraints
    assert refreshed["candidates"] == updated["candidates"]
    assert refreshed["request"]["objective"] == "annualized_return"
    assert refreshed["summary"]["objective"] == "annualized_return"


def test_patch_optimization_job_constraints_previews_filtered_result_without_mutating_source(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    base = create_momentum_strategy(client, idempotency_key="optimization-patch-constraint-clean")
    strategy = base["strategy"]
    job_id = "opt_patch_constraint_refresh_clean"
    created_at = "2026-04-13T10:00:00Z"
    request_payload = {
        "objective": "return_sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": 5,
        "search_space": [
            {"key": "lookback_months", "label": "Lookback", "mode": "range", "start": 6, "end": 7, "step": 1, "current": 6},
            {
                "key": "hold_rank_threshold",
                "label": "Hold Rank",
                "mode": "range",
                "start": 120,
                "end": 160,
                "step": 10,
                "current": 120,
            },
        ],
        "status": "COMPLETED",
        "progress_pct": 100,
        "completed_combinations": 5,
        "persisted_trial_count": 5,
        "next_trial_index": 6,
        "current_stage": "Result ready",
        "latest_update": "Optimization completed.",
    }

    def build_trial(
        *,
        trial_index: int,
        snapshot: dict[str, Any],
        score: float,
        annualized_return: float,
        return_sharpe: float,
        out_of_sample_sharpe: float,
        max_drawdown_pct: float,
        stability: float,
        total_return_pct: float,
        turnover: float = 0.08,
    ) -> dict[str, Any]:
        metrics = {
            "total_return": total_return_pct / 100.0,
            "total_return_pct": total_return_pct,
            "cagr": annualized_return,
            "annualized_return": annualized_return,
            "annualized_volatility": 0.18,
            "sharpe": return_sharpe,
            "return_sharpe": return_sharpe,
            "oos_cagr": annualized_return * 0.9,
            "oos_sharpe": out_of_sample_sharpe,
            "out_of_sample_sharpe": out_of_sample_sharpe,
            "max_drawdown": max_drawdown_pct / 100.0,
            "max_drawdown_pct": max_drawdown_pct,
            "turnover": turnover,
            "win_rate": 0.58,
            "stability": stability,
        }
        return {
            "trial_index": trial_index,
            "parameter_snapshot": snapshot,
            "metrics": metrics,
            "chart_series": [
                {
                    "trade_date": f"2026-01-0{offset + 1}",
                    "equity": 100.0 + trial_index + offset,
                    "benchmark": 100.0,
                    "drawdown": max_drawdown_pct if offset == 1 else 0.0,
                    "is_oos": offset >= 2,
                    "strategy_return": 0.01,
                    "benchmark_return": 0.005,
                }
                for offset in range(4)
            ],
            "score": score,
        }

    base_snapshot = dict(strategy.get("parameters") or {})
    trial_rows = [
        build_trial(
            trial_index=1,
            snapshot={**base_snapshot, "lookback_months": 6, "hold_rank_threshold": 120},
            score=98.0,
            annualized_return=0.11,
            return_sharpe=1.25,
            out_of_sample_sharpe=0.78,
            max_drawdown_pct=-38.0,
            stability=62.0,
            total_return_pct=65.0,
        ),
        build_trial(
            trial_index=2,
            snapshot={**base_snapshot, "lookback_months": 6, "hold_rank_threshold": 130},
            score=97.5,
            annualized_return=0.11,
            return_sharpe=1.25,
            out_of_sample_sharpe=0.78,
            max_drawdown_pct=-38.0,
            stability=62.0,
            total_return_pct=65.0,
        ),
        build_trial(
            trial_index=3,
            snapshot={**base_snapshot, "lookback_months": 6, "hold_rank_threshold": 140},
            score=94.0,
            annualized_return=0.10,
            return_sharpe=1.10,
            out_of_sample_sharpe=0.92,
            max_drawdown_pct=-18.0,
            stability=79.0,
            total_return_pct=35.0,
        ),
        build_trial(
            trial_index=4,
            snapshot={**base_snapshot, "lookback_months": 7, "hold_rank_threshold": 150},
            score=93.2,
            annualized_return=0.095,
            return_sharpe=1.05,
            out_of_sample_sharpe=0.88,
            max_drawdown_pct=-21.0,
            stability=76.0,
            total_return_pct=33.0,
        ),
        build_trial(
            trial_index=5,
            snapshot={**base_snapshot, "lookback_months": 7, "hold_rank_threshold": 160},
            score=91.0,
            annualized_return=0.085,
            return_sharpe=0.92,
            out_of_sample_sharpe=0.75,
            max_drawdown_pct=-28.0,
            stability=68.0,
            total_return_pct=31.0,
        ),
    ]
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        request_payload,
        [],
        created_at=created_at,
        updated_at=created_at,
        completed_at=created_at,
    )
    for trial in trial_rows:
        service._persist_optimization_trial(
            job_id,
            trial["trial_index"],
            status="SUCCEEDED",
            parameter_snapshot=trial["parameter_snapshot"],
            metrics=trial["metrics"],
            chart_series=trial["chart_series"],
            score=trial["score"],
            error_message=None,
            started_at=created_at,
            completed_at=created_at,
        )

    stale_candidates = [
        service._build_candidate_record(
            strategy=strategy,
            parameter_snapshot=trial_rows[0]["parameter_snapshot"],
            base_parameter_version_id=strategy["current_parameter_version_id"],
            label="候选 1",
            title="Best candidate",
            status_label=service._optimization_status_label(trial_rows[0]["metrics"]),
            metrics=trial_rows[0]["metrics"],
            summary="stale duplicate",
            rank=1,
            score=trial_rows[0]["score"],
            analysis={},
        ),
        service._build_candidate_record(
            strategy=strategy,
            parameter_snapshot=trial_rows[1]["parameter_snapshot"],
            base_parameter_version_id=strategy["current_parameter_version_id"],
            label="候选 2",
            title="Candidate 2",
            status_label=service._optimization_status_label(trial_rows[1]["metrics"]),
            metrics=trial_rows[1]["metrics"],
            summary="stale duplicate",
            rank=2,
            score=trial_rows[1]["score"],
            analysis={},
        ),
    ]
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        {
            **request_payload,
            "best_metrics_summary": service._best_optimization_trial_summary([trial_rows[0], trial_rows[1]]),
        },
        stale_candidates,
        created_at=created_at,
        updated_at=created_at,
        completed_at=created_at,
    )

    updated_constraints = [
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 25,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.8,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 8,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 70,
            "unit": "pts",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 1.0,
            "unit": "",
        },
    ]

    assert_ok(client.get(f"/optimization-jobs/{job_id}/detail"))
    original = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail"))

    updated = assert_ok(
        client.patch(
            f"/optimization-jobs/{job_id}",
            json={
                "objective": "annualized_return",
                "constraint_preset_key": "defensive",
                "constraint_label": "稳健型（自定义）",
                "constraints": updated_constraints,
            },
        )
    )

    compliant_candidates = [
        candidate
        for candidate in updated["candidates"]
        if candidate["metrics"]["max_drawdown_pct"] >= -25.0
        and candidate["metrics"]["out_of_sample_sharpe"] >= 0.8
        and candidate["metrics"]["annualized_return"] >= 0.08
        and candidate["metrics"]["stability"] >= 70.0
        and candidate["metrics"]["return_sharpe"] >= 1.0
    ]

    assert updated["request"]["objective"] == "annualized_return"
    assert updated["request"]["constraint_preset_key"] == "defensive"
    assert updated["request"]["constraint_label"] == "稳健型（自定义）"
    assert updated["request"]["constraints"] == updated_constraints
    assert updated["summary"]["objective"] == "annualized_return"
    assert updated["summary"]["constraint_preset_key"] == "defensive"
    assert updated["summary"]["constraint_label"] == "稳健型（自定义）"
    assert updated["summary"]["constraints"] == updated_constraints
    assert updated["result"]["constraint_preset_key"] == "defensive"
    assert updated["result"]["constraint_label"] == "稳健型（自定义）"
    assert updated["result"]["constraints"] == updated_constraints
    assert len(compliant_candidates) == 2
    assert compliant_candidates[0]["parameter_snapshot"]["hold_rank_threshold"] == 140
    assert compliant_candidates[1]["parameter_snapshot"]["hold_rank_threshold"] == 150
    assert updated["result"]["best_candidate_id"] == compliant_candidates[0]["id"]
    assert updated["result"]["best_candidate_label"] == compliant_candidates[0]["label"]
    assert updated["summary"]["best_metrics_summary"]["label"] == compliant_candidates[0]["label"]
    assert (
        compliant_candidates[0]["metrics"]["annualized_return"]
        >= compliant_candidates[1]["metrics"]["annualized_return"]
    )

    refreshed = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail"))
    assert refreshed["request"]["constraints"] == original["request"]["constraints"]
    assert refreshed["summary"]["constraints"] == original["summary"]["constraints"]
    assert refreshed["result"]["constraints"] == original["result"]["constraints"]
    assert refreshed["request"]["objective"] == original["request"]["objective"]
    assert refreshed["summary"]["objective"] == original["summary"]["objective"]
    assert refreshed["updated_at"] == original["updated_at"]


def test_save_filtered_optimization_result_creates_new_job_without_mutating_source(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="optimization-save-filtered-result")
    strategy = base["strategy"]
    source_job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=4,
    )
    source_detail = assert_ok(client.get(f"/optimization-jobs/{source_job['id']}/detail"))
    original_constraints = source_detail["summary"]["constraints"]
    original_updated_at = source_detail["updated_at"]
    updated_constraints = [
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 25,
            "unit": "%",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 0.1,
            "unit": "",
        },
    ]

    saved = assert_ok(
        client.post(
            f"/optimization-jobs/{source_job['id']}/filtered-results",
            json={
                "objective": "annualized_return",
                "constraint_preset_key": "defensive",
                "constraint_label": "另存过滤结果",
                "constraints": updated_constraints,
            },
        )
    )

    assert saved["id"] != source_job["id"]
    assert saved["strategy_id"] == strategy["id"]
    assert saved["status"] == "COMPLETED"
    assert saved["request"]["source_optimization_job_id"] == source_job["id"]
    assert saved["request"]["entry_point"] == "saved_refilter_result"
    assert saved["request"]["objective"] == "annualized_return"
    assert saved["summary"]["constraint_label"] == "另存过滤结果"
    assert saved["summary"]["constraints"] == updated_constraints
    assert saved["result"]["constraints"] == updated_constraints
    assert saved["matching_combination_count"] is not None

    refreshed_source = assert_ok(client.get(f"/optimization-jobs/{source_job['id']}/detail"))
    assert refreshed_source["summary"]["constraints"] == original_constraints
    assert refreshed_source["updated_at"] == original_updated_at

    refreshed_saved = assert_ok(client.get(f"/optimization-jobs/{saved['id']}/detail"))
    assert refreshed_saved["summary"]["constraints"] == updated_constraints


def test_optimization_job_detail_rebuilds_stale_candidates_even_when_matching_combinations_exist(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    base = create_momentum_strategy(client, idempotency_key="optimization-detail-stale-candidates")
    strategy = base["strategy"]
    job_id = "opt_detail_stale_candidates"
    created_at = "2026-04-17T12:22:23Z"
    constraints = [
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 25,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.8,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 3.2,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 31,
            "unit": "pts",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 0,
            "unit": "",
        },
    ]
    request_payload = {
        "objective": "annualized_return",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": 5,
        "constraint_preset_key": "balanced",
        "constraint_label": "平衡型（自定义）",
        "constraints": constraints,
        "search_space": [
            {
                "key": "lookback_months",
                "label": "Lookback",
                "mode": "range",
                "start": 6,
                "end": 7,
                "step": 1,
                "current": 6,
            },
            {
                "key": "hold_rank_threshold",
                "label": "Hold Rank",
                "mode": "range",
                "start": 120,
                "end": 160,
                "step": 10,
                "current": 120,
            },
        ],
        "status": "COMPLETED",
        "progress_pct": 100,
        "completed_combinations": 5,
        "persisted_trial_count": 5,
        "next_trial_index": 6,
        "current_stage": "Result ready",
        "latest_update": "Optimization completed.",
    }

    def build_trial(
        *,
        trial_index: int,
        hold_rank_threshold: int,
        annualized_return: float,
        return_sharpe: float,
        out_of_sample_sharpe: float,
        max_drawdown_pct: float,
        stability: float,
        score: float,
    ) -> dict[str, Any]:
        parameter_snapshot = {
            **dict(strategy.get("parameters") or {}),
            "lookback_months": 6 if hold_rank_threshold < 150 else 7,
            "hold_rank_threshold": hold_rank_threshold,
        }
        metrics = {
            "total_return": annualized_return * 12.5,
            "total_return_pct": round(annualized_return * 1250.0, 1),
            "cagr": annualized_return,
            "annualized_return": annualized_return,
            "annualized_volatility": 0.12,
            "sharpe": return_sharpe,
            "return_sharpe": return_sharpe,
            "oos_cagr": annualized_return * 0.9,
            "oos_sharpe": out_of_sample_sharpe,
            "out_of_sample_sharpe": out_of_sample_sharpe,
            "max_drawdown": max_drawdown_pct / 100.0,
            "max_drawdown_pct": max_drawdown_pct,
            "turnover": 0.02,
            "win_rate": 0.55,
            "stability": stability,
        }
        chart_series = [
            {
                "trade_date": f"2026-01-{offset + 1:02d}",
                "equity": 100.0 + trial_index + offset,
                "benchmark": 100.0,
                "drawdown": max_drawdown_pct if offset == 1 else 0.0,
                "is_oos": offset >= 2,
                "strategy_return": 0.01,
                "benchmark_return": 0.005,
            }
            for offset in range(4)
        ]
        return {
            "trial_index": trial_index,
            "parameter_snapshot": parameter_snapshot,
            "metrics": metrics,
            "chart_series": chart_series,
            "score": score,
            "status": "SUCCEEDED",
        }

    trial_rows = [
        build_trial(
            trial_index=1,
            hold_rank_threshold=120,
            annualized_return=0.055016279741659124,
            return_sharpe=1.1033606102839923,
            out_of_sample_sharpe=0.9056688224064549,
            max_drawdown_pct=-7.1,
            stability=45.0,
            score=60.231,
        ),
        build_trial(
            trial_index=2,
            hold_rank_threshold=130,
            annualized_return=0.04294567225488577,
            return_sharpe=1.1050202364585147,
            out_of_sample_sharpe=0.8737817369371537,
            max_drawdown_pct=-4.4,
            stability=34.0,
            score=58.642,
        ),
        build_trial(
            trial_index=3,
            hold_rank_threshold=140,
            annualized_return=0.1188562830399611,
            return_sharpe=0.8738660816787448,
            out_of_sample_sharpe=0.8259518690898243,
            max_drawdown_pct=-23.5,
            stability=51.0,
            score=53.19,
        ),
        build_trial(
            trial_index=4,
            hold_rank_threshold=150,
            annualized_return=0.11784251345625019,
            return_sharpe=0.8579847458466511,
            out_of_sample_sharpe=0.8345755565326178,
            max_drawdown_pct=-24.4,
            stability=51.0,
            score=52.36,
        ),
        build_trial(
            trial_index=5,
            hold_rank_threshold=160,
            annualized_return=0.11573597374877354,
            return_sharpe=0.8684406520870985,
            out_of_sample_sharpe=0.8410865020430262,
            max_drawdown_pct=-22.0,
            stability=51.0,
            score=53.853,
        ),
    ]
    stale_candidates = service._build_optimization_candidate_records(
        strategy,
        request_payload,
        [trial_rows[0], trial_rows[1]],
        heatmap_trials=trial_rows,
        preserve_trial_order=True,
    )
    for index, candidate in enumerate(stale_candidates, start=1):
        candidate["id"] = f"stale_candidate_{index}"

    matching_combinations = service._build_optimization_matching_combination_candidates(
        strategy=strategy,
        payload=request_payload,
        trials=trial_rows,
    )
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        {
            **request_payload,
            "best_metrics_summary": service._best_optimization_trial_summary(
                [trial_rows[0], trial_rows[1]],
                request_payload["objective"],
            ),
            "matching_combination_count": len(matching_combinations),
            "matching_combinations": matching_combinations,
            "matching_combination_source": "all_trials",
        },
        stale_candidates,
        created_at=created_at,
        updated_at=created_at,
        completed_at=created_at,
    )
    for trial in trial_rows:
        service._persist_optimization_trial(
            job_id,
            trial["trial_index"],
            status="SUCCEEDED",
            parameter_snapshot=trial["parameter_snapshot"],
            metrics=trial["metrics"],
            chart_series=trial["chart_series"],
            score=trial["score"],
            error_message=None,
            started_at=created_at,
            completed_at=created_at,
        )

    detail = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail"))
    stored_row = service.storage.fetch_one(
        "SELECT candidates_json, summary_json FROM optimization_jobs WHERE id = ?",
        (job_id,),
    )
    assert stored_row is not None
    persisted_candidates = json.loads(stored_row["candidates_json"])
    persisted_summary = json.loads(stored_row["summary_json"])

    assert abs(detail["matching_combinations"][0]["metrics"]["annualized_return"] - 0.1188562830399611) < 1e-12
    assert detail["candidates"][0]["parameter_snapshot"]["hold_rank_threshold"] == 140
    assert abs(detail["candidates"][0]["metrics"]["annualized_return"] - 0.1188562830399611) < 1e-12
    assert detail["summary"]["best_metrics_summary"]["parameter_snapshot"]["hold_rank_threshold"] == 140
    assert abs(detail["summary"]["best_metrics_summary"]["metrics"]["annualized_return"] - 0.1188562830399611) < 1e-12
    assert persisted_candidates[0]["parameter_snapshot"]["hold_rank_threshold"] == 140
    assert abs(
        persisted_summary["best_metrics_summary"]["metrics"]["annualized_return"] - 0.1188562830399611
    ) < 1e-12


def test_legacy_optimization_job_detail_backfills_constraint_contract_fields(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="optimization-legacy-constraint")
    strategy = base["strategy"]
    legacy_job_id = "opt_legacy_constraint_detail"
    client.app.state.service.storage.insert_json_row(
        "optimization_jobs",
        {
            "id": legacy_job_id,
            "strategy_id": strategy["id"],
            "status": "COMPLETED",
            "request_json": json.dumps(
                {
                    "objective": "sharpe",
                    "base_parameter_version_id": strategy["current_parameter_version_id"],
                    "entry_point": "lab_menu",
                    "validation_mode": "walk_forward",
                    "budget_combinations": 4,
                    "status": "COMPLETED",
                    "progress_pct": 100,
                    "completed_combinations": 4,
                    "current_stage": "Result ready",
                    "latest_update": "Optimization completed.",
                }
            ),
            "summary_json": json.dumps(
                {
                    "objective": "sharpe",
                    "baseline_parameter_version_id": strategy["current_parameter_version_id"],
                    "entry_point": "lab_menu",
                    "validation_mode": "walk_forward",
                    "budget_combinations": 4,
                    "completed_combinations": 4,
                    "persisted_trial_count": 4,
                    "next_trial_index": 5,
                    "status": "COMPLETED",
                    "progress_pct": 100,
                    "current_stage": "Result ready",
                    "latest_update": "Optimization completed.",
                    "resume_ready": False,
                }
            ),
            "result_json": json.dumps(
                {
                    "best_candidate_id": "trial_1",
                    "best_candidate_label": "Trial 1",
                    "baseline_parameter_version_id": strategy["current_parameter_version_id"],
                    "headline": "Optimization completed",
                    "summary": "Optimization completed.",
                    "stability_verdict": None,
                    "status": "COMPLETED",
                    "progress_pct": 100,
                    "current_stage": "Result ready",
                    "latest_update": "Optimization completed.",
                }
            ),
            "candidates_json": json.dumps([]),
            "created_at": "2026-04-13T10:00:00Z",
            "updated_at": "2026-04-13T10:10:00Z",
            "completed_at": "2026-04-13T10:10:00Z",
        },
    )

    detail = assert_ok(client.get(f"/optimization-jobs/{legacy_job_id}/detail"))

    assert detail["constraint_preset_key"] == "balanced"
    assert detail["constraint_label"] == "平衡型"
    assert detail["constraints"]
    assert all(item["key"] != "turnover" for item in detail["constraints"])
    assert detail["summary"]["matching_combination_count"] == 0
    assert detail["request"]["constraint_preset_key"] == "balanced"
    assert detail["summary"]["constraint_preset_key"] == "balanced"
    assert detail["result"]["constraint_preset_key"] == "balanced"
    assert all(item["key"] != "turnover" for item in detail["request"]["constraints"])
    assert all(item["key"] != "turnover" for item in detail["summary"]["constraints"])
    assert all(item["key"] != "turnover" for item in detail["result"]["constraints"])


def test_legacy_optimization_job_detail_counts_matches_from_persisted_candidates_when_trial_rows_are_missing(
    tmp_path,
):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="optimization-legacy-candidate-count")
    strategy = base["strategy"]
    legacy_job_id = "opt_legacy_candidate_count"
    legacy_constraints = [
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 25,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.8,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 8,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 38,
            "unit": "pts",
        },
        {
            "key": "turnover",
            "label": "换手率",
            "category": "risk",
            "operator": "<=",
            "value": 12,
            "unit": "%",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 0.89,
            "unit": "",
        },
    ]
    client.app.state.service.storage.insert_json_row(
        "optimization_jobs",
        {
            "id": legacy_job_id,
            "strategy_id": strategy["id"],
            "status": "COMPLETED",
            "request_json": json.dumps(
                {
                    "objective": "sharpe",
                    "base_parameter_version_id": strategy["current_parameter_version_id"],
                    "entry_point": "lab_menu",
                    "validation_mode": "walk_forward",
                    "budget_combinations": 4,
                    "status": "COMPLETED",
                    "progress_pct": 100,
                    "completed_combinations": 4,
                    "current_stage": "Result ready",
                    "latest_update": "Optimization completed.",
                    "constraint_preset_key": "balanced",
                    "constraint_label": "平衡型（自定义）",
                    "constraints": legacy_constraints,
                }
            ),
            "summary_json": json.dumps(
                {
                    "objective": "sharpe",
                    "baseline_parameter_version_id": strategy["current_parameter_version_id"],
                    "entry_point": "lab_menu",
                    "validation_mode": "walk_forward",
                    "budget_combinations": 4,
                    "completed_combinations": 4,
                    "persisted_trial_count": 4,
                    "next_trial_index": 5,
                    "status": "COMPLETED",
                    "progress_pct": 100,
                    "current_stage": "Result ready",
                    "latest_update": "Optimization completed.",
                    "resume_ready": False,
                    "constraint_preset_key": "balanced",
                    "constraint_label": "平衡型（自定义）",
                    "constraints": legacy_constraints,
                }
            ),
            "result_json": json.dumps(
                {
                    "best_candidate_id": "trial_1",
                    "best_candidate_label": "Trial 1",
                    "baseline_parameter_version_id": strategy["current_parameter_version_id"],
                    "headline": "Optimization completed",
                    "summary": "Optimization completed.",
                    "stability_verdict": None,
                    "status": "COMPLETED",
                    "progress_pct": 100,
                    "current_stage": "Result ready",
                    "latest_update": "Optimization completed.",
                    "constraint_preset_key": "balanced",
                    "constraint_label": "平衡型（自定义）",
                    "constraints": legacy_constraints,
                }
            ),
            "candidates_json": json.dumps(
                [
                    {
                        "id": "trial_1",
                        "label": "Trial 1",
                        "title": "Current best",
                        "status": "SUCCEEDED",
                        "rank": 1,
                        "score": 1.661,
                        "metrics": {
                            "annualized_return": 0.11431314484098931,
                            "return_sharpe": 0.8946370789283283,
                            "out_of_sample_sharpe": 0.9048913348697332,
                            "max_drawdown_pct": -22.5,
                            "turnover": 0.004932378679395381,
                            "stability": 38.0,
                            "total_return_pct": 194.4,
                        },
                    },
                    {
                        "id": "trial_2",
                        "label": "Trial 2",
                        "title": "Needs review",
                        "status": "SUCCEEDED",
                        "rank": 2,
                        "score": 1.2,
                        "metrics": {
                            "annualized_return": 0.05,
                            "return_sharpe": 0.7,
                            "out_of_sample_sharpe": 0.6,
                            "max_drawdown_pct": -33.7,
                            "turnover": 0.15,
                            "stability": 20.0,
                            "total_return_pct": 80.0,
                        },
                    },
                ]
            ),
            "created_at": "2026-04-13T10:00:00Z",
            "updated_at": "2026-04-13T10:10:00Z",
            "completed_at": "2026-04-13T10:10:00Z",
        },
    )

    detail = assert_ok(client.get(f"/optimization-jobs/{legacy_job_id}/detail"))

    assert detail["summary"]["candidate_count"] == 2
    assert detail["summary"]["matching_combination_count"] == 1
    assert detail["summary"]["matching_combination_source"] == "persisted_candidates"
    assert detail["matching_combination_source"] == "persisted_candidates"
    assert detail["result"]["best_candidate_id"] == "trial_1"
    assert all(item["key"] != "turnover" for item in detail["request"]["constraints"])
    assert all(item["key"] != "turnover" for item in detail["summary"]["constraints"])
    assert all(item["key"] != "turnover" for item in detail["result"]["constraints"])


def test_patch_legacy_optimization_job_constraints_preserves_candidate_only_match_scope_when_trial_rows_are_missing(
    tmp_path,
):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="optimization-legacy-candidate-refilter")
    strategy = base["strategy"]
    legacy_job_id = "opt_legacy_candidate_refilter"
    legacy_constraints = [
        {
            "key": "max_drawdown_pct",
            "label": "最大回撤",
            "category": "risk",
            "operator": "<=",
            "value": 25,
            "unit": "%",
        },
        {
            "key": "out_of_sample_sharpe",
            "label": "样本外夏普",
            "category": "stability",
            "operator": ">=",
            "value": 0.8,
            "unit": "",
        },
        {
            "key": "annualized_return",
            "label": "年化收益率",
            "category": "return",
            "operator": ">=",
            "value": 8,
            "unit": "%",
        },
        {
            "key": "stability",
            "label": "稳定度",
            "category": "stability",
            "operator": ">=",
            "value": 38,
            "unit": "pts",
        },
        {
            "key": "return_sharpe",
            "label": "收益夏普",
            "category": "return",
            "operator": ">=",
            "value": 0.89,
            "unit": "",
        },
    ]
    client.app.state.service.storage.insert_json_row(
        "optimization_jobs",
        {
            "id": legacy_job_id,
            "strategy_id": strategy["id"],
            "status": "COMPLETED",
            "request_json": json.dumps(
                {
                    "objective": "sharpe",
                    "base_parameter_version_id": strategy["current_parameter_version_id"],
                    "entry_point": "lab_menu",
                    "validation_mode": "walk_forward",
                    "budget_combinations": 4,
                    "status": "COMPLETED",
                    "progress_pct": 100,
                    "completed_combinations": 4,
                    "current_stage": "Result ready",
                    "latest_update": "Optimization completed.",
                    "constraint_preset_key": "balanced",
                    "constraint_label": "平衡型（历史任务）",
                    "constraints": legacy_constraints,
                }
            ),
            "summary_json": json.dumps(
                {
                    "objective": "sharpe",
                    "baseline_parameter_version_id": strategy["current_parameter_version_id"],
                    "entry_point": "lab_menu",
                    "validation_mode": "walk_forward",
                    "budget_combinations": 4,
                    "completed_combinations": 4,
                    "persisted_trial_count": 4,
                    "next_trial_index": 5,
                    "status": "COMPLETED",
                    "progress_pct": 100,
                    "current_stage": "Result ready",
                    "latest_update": "Optimization completed.",
                    "resume_ready": False,
                    "constraint_preset_key": "balanced",
                    "constraint_label": "平衡型（历史任务）",
                    "constraints": legacy_constraints,
                }
            ),
            "result_json": json.dumps(
                {
                    "best_candidate_id": "trial_1",
                    "best_candidate_label": "Trial 1",
                    "baseline_parameter_version_id": strategy["current_parameter_version_id"],
                    "headline": "Optimization completed",
                    "summary": "Optimization completed.",
                    "stability_verdict": None,
                    "status": "COMPLETED",
                    "progress_pct": 100,
                    "current_stage": "Result ready",
                    "latest_update": "Optimization completed.",
                    "constraint_preset_key": "balanced",
                    "constraint_label": "平衡型（历史任务）",
                    "constraints": legacy_constraints,
                }
            ),
            "candidates_json": json.dumps(
                [
                    {
                        "id": "trial_1",
                        "label": "Trial 1",
                        "title": "Current best",
                        "status": "SUCCEEDED",
                        "rank": 1,
                        "score": 1.661,
                        "metrics": {
                            "annualized_return": 0.11431314484098931,
                            "return_sharpe": 0.8946370789283283,
                            "out_of_sample_sharpe": 0.9048913348697332,
                            "max_drawdown_pct": -22.5,
                            "stability": 38.0,
                            "total_return_pct": 194.4,
                        },
                    },
                    {
                        "id": "trial_2",
                        "label": "Trial 2",
                        "title": "Needs review",
                        "status": "SUCCEEDED",
                        "rank": 2,
                        "score": 1.2,
                        "metrics": {
                            "annualized_return": 0.05,
                            "return_sharpe": 0.7,
                            "out_of_sample_sharpe": 0.6,
                            "max_drawdown_pct": -33.7,
                            "stability": 20.0,
                            "total_return_pct": 80.0,
                        },
                    },
                ]
            ),
            "created_at": "2026-04-13T10:00:00Z",
            "updated_at": "2026-04-13T10:10:00Z",
            "completed_at": "2026-04-13T10:10:00Z",
        },
    )

    updated = assert_ok(
        client.patch(
            f"/optimization-jobs/{legacy_job_id}",
            json={
                "constraints": [
                    {
                        "key": "max_drawdown_pct",
                        "label": "最大回撤",
                        "category": "risk",
                        "operator": "<=",
                        "value": 25,
                        "unit": "%",
                    },
                    {
                        "key": "out_of_sample_sharpe",
                        "label": "样本外夏普",
                        "category": "stability",
                        "operator": ">=",
                        "value": 0.9,
                        "unit": "",
                    },
                    {
                        "key": "annualized_return",
                        "label": "年化收益率",
                        "category": "return",
                        "operator": ">=",
                        "value": 8,
                        "unit": "%",
                    },
                    {
                        "key": "stability",
                        "label": "稳定度",
                        "category": "stability",
                        "operator": ">=",
                        "value": 38,
                        "unit": "pts",
                    },
                    {
                        "key": "return_sharpe",
                        "label": "收益夏普",
                        "category": "return",
                        "operator": ">=",
                        "value": 0.89,
                        "unit": "",
                    },
                ]
            },
        )
    )

    assert updated["summary"]["matching_combination_count"] == 1
    assert updated["summary"]["matching_combination_source"] == "persisted_candidates"
    assert updated["matching_combination_source"] == "persisted_candidates"


def test_list_optimization_jobs_uses_lightweight_projection_without_detail_queries(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    base = create_momentum_strategy(client, idempotency_key="optimization-list-lightweight")
    strategy = base["strategy"]
    completed = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        entry_point="lab_menu",
        validation_mode="walk_forward",
        budget_combinations=4,
        search_space=[
            {"key": "lookback_months", "label": "Lookback", "mode": "range", "start": 5, "end": 6, "step": 1, "current": 6},
            {"key": "top_n", "label": "Top N", "mode": "range", "start": 3, "end": 4, "step": 1, "current": 4},
        ],
    )
    service._persist_optimization_job(
        "opt_running_projection",
        strategy["id"],
        {
            "objective": "sharpe",
            "base_parameter_version_id": strategy["current_parameter_version_id"],
            "source_run_id": strategy["latest_successful_run_id"],
            "entry_point": "lab_menu",
            "validation_mode": "walk_forward",
            "budget_combinations": 4,
            "completed_combinations": 1,
            "persisted_trial_count": 1,
            "next_trial_index": 2,
            "progress_pct": 25,
            "status": "RUNNING",
            "current_stage": "Running trial 2/4",
            "latest_update": "Completed 1/4 trials.",
            "estimated_remaining_minutes": 3,
            "estimated_completed_at": "2026-04-13T10:08:00Z",
            "best_metrics_summary": {
                "trial_index": 1,
                "label": "Candidate 1",
                "status": "SUCCEEDED",
                "parameter_snapshot": {"lookback_months": 6, "top_n": 4},
                "metrics": {
                    "annualized_return": 0.12,
                    "return_sharpe": 1.04,
                    "out_of_sample_sharpe": 0.88,
                    "max_drawdown_pct": -18.0,
                    "stability": 78.0,
                    "total_return_pct": 13.0,
                },
                "score": 1.42,
                "error_message": None,
                "started_at": "2026-04-13T10:00:00Z",
                "completed_at": "2026-04-13T10:02:00Z",
            },
        },
        [],
        created_at="2026-04-13T10:00:00Z",
        updated_at="2026-04-13T10:05:00Z",
        completed_at=None,
    )

    def fail(method_name: str):
        def _fail(*args, **kwargs):
            raise AssertionError(f"{method_name} should not be used by list_optimization_jobs")

        return _fail

    monkeypatch.setattr(service, "_hydrate_optimization_job", fail("_hydrate_optimization_job"))
    monkeypatch.setattr(service, "_load_optimization_trials", fail("_load_optimization_trials"))
    monkeypatch.setattr(service, "get_strategy_detail", fail("get_strategy_detail"))

    jobs = assert_ok(client.get("/optimization-jobs"))

    running = next(item for item in jobs if item["id"] == "opt_running_projection")
    completed_item = next(item for item in jobs if item["id"] == completed["id"])

    assert running["strategy_name"] == strategy["name"]
    assert running["status"] == "RUNNING"
    assert running["entry_point"] == "lab_menu"
    assert running["validation_mode"] == "walk_forward"
    assert running["source_run_id"] == strategy["latest_successful_run_id"]
    assert running["budget_combinations"] == 4
    assert running["completed_combinations"] == 1
    assert running["progress_pct"] == 25
    assert running["current_stage"] == "Running trial 2/4"
    assert running["latest_update"] == "Completed 1/4 trials."
    assert running["estimated_remaining_minutes"] == 3
    assert running["estimated_completed_at"] == "2026-04-13T10:08:00Z"
    assert running["resume_ready"] is False
    assert running["persisted_trial_count"] == 1
    assert running["next_trial_index"] == 2
    assert running["best_metrics_summary"]["trial_index"] == 1
    assert running["best_metrics_summary"]["label"] == "Candidate 1"
    assert completed_item["strategy_name"] == strategy["name"]
    assert completed_item["best_candidate_id"] is not None
    assert completed_item["best_candidate_label"] is not None


def test_large_optimization_job_json_is_compacted_and_detail_can_stream_preview(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    base = create_momentum_strategy(client, idempotency_key="optimization-large-json-preview")
    strategy = base["strategy"]
    job_id = "opt_large_matching_payload"
    created_at = "2026-04-18T09:00:00Z"
    matching_combinations = [
        {
            "id": f"trial_{index}",
            "rank": index,
            "label": f"Candidate {index}",
            "status": "SUCCEEDED",
            "parameter_snapshot": {
                "lookback_months": 6 + (index % 4),
                "top_n": 5 + (index % 3),
            },
            "metrics": {
                "annualized_return": 0.05 + index / 10000,
                "return_sharpe": 0.8 + index / 1000,
                "out_of_sample_sharpe": 0.9,
                "max_drawdown_pct": -12.0,
                "stability": 70.0,
            },
            "score": 0.8 + index / 1000,
            "trace_payload": "x" * 5000,
        }
        for index in range(1, 261)
    ]
    candidates = [dict(item) for item in matching_combinations[:5]]
    request_payload = {
        "objective": "return_sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "source_run_id": strategy["latest_successful_run_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": len(matching_combinations),
        "completed_combinations": len(matching_combinations),
        "persisted_trial_count": len(matching_combinations),
        "next_trial_index": len(matching_combinations) + 1,
        "status": "COMPLETED",
        "progress_pct": 100,
        "current_stage": "Result ready",
        "latest_update": "Optimization completed.",
        "constraint_preset_key": "custom",
        "constraint_label": "Preview-safe",
        "constraints": [
            {
                "key": "return_sharpe",
                "label": "Sharpe",
                "category": "return",
                "operator": ">=",
                "value": 0,
                "unit": "",
            }
        ],
        "matching_combination_count": len(matching_combinations),
        "matching_combinations": matching_combinations,
        "matching_combination_source": "all_trials",
    }
    summary_payload = {
        **request_payload,
        "candidate_count": len(candidates),
        "best_metrics_summary": {
            "trial_index": 1,
            "label": "Candidate 1",
            "status": "SUCCEEDED",
            "parameter_snapshot": matching_combinations[0]["parameter_snapshot"],
            "metrics": matching_combinations[0]["metrics"],
            "score": matching_combinations[0]["score"],
        },
    }
    result_payload = {
        "best_candidate_id": "trial_1",
        "best_candidate_label": "Candidate 1",
        "headline": "Result ready",
        "summary": "Optimization completed.",
        "status": "COMPLETED",
        "progress_pct": 100,
    }
    service.storage.insert_json_row(
        "optimization_jobs",
        {
            "id": job_id,
            "strategy_id": strategy["id"],
            "status": "COMPLETED",
            "request_json": json.dumps(request_payload),
            "summary_json": json.dumps(summary_payload),
            "result_json": json.dumps(result_payload),
            "candidates_json": json.dumps(candidates),
            "created_at": created_at,
            "updated_at": created_at,
            "completed_at": created_at,
        },
    )
    for trial in matching_combinations:
        service._persist_optimization_trial(
            job_id,
            int(trial["rank"]),
            status="SUCCEEDED",
            parameter_snapshot=trial["parameter_snapshot"],
            metrics=trial["metrics"],
            chart_series=[],
            score=trial["score"],
            error_message=None,
            started_at=created_at,
            completed_at=created_at,
        )

    service._optimization_job_json_compaction_done = False
    service._compact_existing_optimization_job_json_once()
    compacted_row = service.storage.fetch_one(
        "SELECT request_json, summary_json FROM optimization_jobs WHERE id = ?",
        (job_id,),
    )
    assert compacted_row is not None
    compacted_request = json.loads(compacted_row["request_json"])
    compacted_summary = json.loads(compacted_row["summary_json"])
    assert compacted_request["matching_combinations"] == []
    assert compacted_summary["matching_combinations"] == []
    assert compacted_summary["matching_combination_count"] == len(matching_combinations)

    refiltered = assert_ok(
        client.patch(
            f"/optimization-jobs/{job_id}",
            json={
                "objective": "return_sharpe",
                "constraint_preset_key": "balanced",
                "constraint_label": "Preview-safe",
                "constraints": request_payload["constraints"],
            },
        )
    )
    assert refiltered["matching_combination_count"] == len(matching_combinations)
    assert refiltered["matching_combination_source"] == "all_trials"
    assert len(refiltered["matching_combinations"]) == len(matching_combinations)

    def fail_trial_loader(*args, **kwargs):
        raise AssertionError("preview detail should not load the full optimization trial table")

    monkeypatch.setattr(service, "_load_optimization_trials", fail_trial_loader)
    detail = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail?matching_limit=2"))

    assert detail["summary"]["matching_combination_count"] == len(matching_combinations)
    assert detail["matching_combination_count"] == len(matching_combinations)
    assert len(detail["matching_combinations"]) == 2


def test_completed_optimization_job_detail_repairs_weight_sum_matching_count_and_budget(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    base = create_momentum_strategy(client, idempotency_key="optimization-weight-sum-count-repair")
    strategy = base["strategy"]
    job_id = "opt_weight_sum_count_repair"
    created_at = "2026-05-15T09:00:00Z"
    constraints = [
        {
            "key": "return_sharpe",
            "label": "Sharpe",
            "category": "return",
            "operator": ">=",
            "value": -100,
            "unit": "",
        }
    ]
    search_space = [
        {
            "key": "allocation_weight__SPY_pct",
            "label": "SPY weight",
            "mode": "range",
            "start": 50,
            "end": 75,
            "step": 25,
            "current": 50,
        },
        {
            "key": "allocation_weight__TLT_pct",
            "label": "TLT weight",
            "mode": "range",
            "start": 25,
            "end": 50,
            "step": 25,
            "current": 50,
        },
    ]

    def build_combination(rank: int, spy_weight: int, tlt_weight: int, sharpe: float) -> dict[str, Any]:
        metrics = {
            "annualized_return": 0.10 + rank / 100,
            "return_sharpe": sharpe,
            "out_of_sample_sharpe": sharpe - 0.1,
            "max_drawdown_pct": -8.0,
            "stability": 72.0,
            "total_return_pct": 10.0 + rank,
        }
        return {
            "id": f"trial_{rank}",
            "rank": rank,
            "label": f"Candidate {rank}",
            "status": "SUCCEEDED",
            "parameter_snapshot": {
                **dict(strategy.get("parameters") or {}),
                "allocation_weight__SPY_pct": spy_weight,
                "allocation_weight__TLT_pct": tlt_weight,
            },
            "metrics": metrics,
            "score": sharpe,
        }

    matching_combinations = [
        build_combination(1, 50, 50, 1.25),
        build_combination(2, 75, 25, 1.15),
    ]
    request_payload = {
        "objective": "return_sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "source_run_id": strategy["latest_successful_run_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": 4,
        "completed_combinations": 2,
        "persisted_trial_count": 2,
        "next_trial_index": 3,
        "status": "COMPLETED",
        "progress_pct": 100,
        "current_stage": "Result ready",
        "latest_update": "Optimization completed.",
        "constraints": constraints,
        "search_space": search_space,
        "matching_combination_count": 1,
        "matching_combinations": [matching_combinations[0]],
        "matching_combination_source": "all_trials",
    }
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        request_payload,
        [matching_combinations[0]],
        created_at=created_at,
        updated_at=created_at,
        completed_at=created_at,
    )
    for combination in matching_combinations:
        service._persist_optimization_trial(
            job_id,
            int(combination["rank"]),
            status="SUCCEEDED",
            parameter_snapshot=combination["parameter_snapshot"],
            metrics=combination["metrics"],
            chart_series=[],
            score=combination["score"],
            error_message=None,
            started_at=created_at,
            completed_at=created_at,
        )

    listed_jobs = assert_ok(client.get("/optimization-jobs"))
    listed_job = next(job for job in listed_jobs if job["id"] == job_id)
    assert listed_job["completed_combinations"] == 2
    assert listed_job["budget_combinations"] == 2
    assert listed_job["next_trial_index"] == 3

    preview = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail?matching_limit=1"))
    assert preview["request"]["budget_combinations"] == 2
    assert preview["summary"]["budget_combinations"] == 2
    assert preview["matching_combination_count"] == 2
    assert len(preview["matching_combinations"]) == 1

    full = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail"))
    assert full["matching_combination_count"] == 2
    assert {item["id"] for item in full["matching_combinations"]} == {"trial_1", "trial_2"}


def test_completed_optimization_job_detail_rebuilds_full_matching_combinations_from_preview(
    tmp_path,
):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    base = create_momentum_strategy(
        client,
        idempotency_key="optimization-full-matching-from-preview",
    )
    strategy = base["strategy"]
    job_id = "opt_full_matching_from_preview"
    created_at = "2026-05-07T09:00:00Z"
    matching_combinations = [
        {
            "id": f"trial_{index}",
            "rank": index,
            "label": f"Candidate {index}",
            "status": "SUCCEEDED",
            "parameter_snapshot": {
                "lookback_months": 6 + (index % 4),
                "top_n": 5 + (index % 3),
            },
            "metrics": {
                "annualized_return": 0.05 + index / 10000,
                "return_sharpe": 0.8 + index / 1000,
                "out_of_sample_sharpe": 0.9,
                "max_drawdown_pct": -12.0,
                "stability": 70.0,
            },
            "score": 0.8 + index / 1000,
        }
        for index in range(1, 121)
    ]
    preview_combinations = matching_combinations[:4]
    candidates = [dict(item) for item in preview_combinations]
    request_payload = {
        "objective": "return_sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "source_run_id": strategy["latest_successful_run_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": len(matching_combinations),
        "completed_combinations": len(matching_combinations),
        "persisted_trial_count": len(matching_combinations),
        "next_trial_index": len(matching_combinations) + 1,
        "status": "COMPLETED",
        "progress_pct": 100,
        "current_stage": "Result ready",
        "latest_update": "Optimization completed.",
        "constraint_preset_key": "custom",
        "constraint_label": "Full modal",
        "constraints": [
            {
                "key": "return_sharpe",
                "label": "Sharpe",
                "category": "return",
                "operator": ">=",
                "value": 0,
                "unit": "",
            }
        ],
        "matching_combination_count": len(matching_combinations),
        "matching_combinations": preview_combinations,
        "matching_combination_source": "all_trials",
    }
    summary_payload = {
        **request_payload,
        "candidate_count": len(candidates),
        "best_metrics_summary": {
            "trial_index": 1,
            "label": "Candidate 1",
            "status": "SUCCEEDED",
            "parameter_snapshot": matching_combinations[0]["parameter_snapshot"],
            "metrics": matching_combinations[0]["metrics"],
            "score": matching_combinations[0]["score"],
        },
    }
    service.storage.insert_json_row(
        "optimization_jobs",
        {
            "id": job_id,
            "strategy_id": strategy["id"],
            "status": "COMPLETED",
            "request_json": json.dumps(request_payload),
            "summary_json": json.dumps(summary_payload),
            "result_json": json.dumps(
                {
                    "best_candidate_id": "trial_1",
                    "best_candidate_label": "Candidate 1",
                    "headline": "Result ready",
                    "summary": "Optimization completed.",
                    "status": "COMPLETED",
                    "progress_pct": 100,
                }
            ),
            "candidates_json": json.dumps(candidates),
            "created_at": created_at,
            "updated_at": created_at,
            "completed_at": created_at,
        },
    )
    for trial in matching_combinations:
        service._persist_optimization_trial(
            job_id,
            int(trial["rank"]),
            status="SUCCEEDED",
            parameter_snapshot=trial["parameter_snapshot"],
            metrics=trial["metrics"],
            chart_series=[],
            score=trial["score"],
            error_message=None,
            started_at=created_at,
            completed_at=created_at,
        )

    preview = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail?matching_limit=4"))
    assert preview["matching_combination_count"] == len(matching_combinations)
    assert len(preview["matching_combinations"]) == 4

    full = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail"))
    assert full["matching_combination_count"] == len(matching_combinations)
    assert full["matching_combination_source"] == "all_trials"
    assert len(full["matching_combinations"]) == len(matching_combinations)
    assert full["matching_combinations"][0]["id"] == "trial_120"
    assert {item["id"] for item in full["matching_combinations"]} == {
        item["id"] for item in matching_combinations
    }


def test_queued_and_interrupted_optimization_jobs_hide_stale_eta_projection(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    base = create_momentum_strategy(client, idempotency_key="optimization-hide-stale-eta")
    strategy = base["strategy"]
    created_at = "2026-04-13T10:00:00Z"
    stale_eta_summary = {
        "objective": "sharpe",
        "baseline_parameter_version_id": strategy["current_parameter_version_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "source_run_id": strategy["latest_successful_run_id"],
        "budget_combinations": 4,
        "completed_combinations": 1,
        "persisted_trial_count": 1,
        "next_trial_index": 2,
        "progress_pct": 25,
        "estimated_remaining_minutes": 14,
        "estimated_completed_at": "2026-04-13T10:14:00Z",
        "heartbeat_at": "2026-04-13T10:01:00Z",
        "best_metrics_summary": {
            "trial_index": 1,
            "label": "Candidate 1",
            "status": "SUCCEEDED",
            "parameter_snapshot": {"lookback_months": 6, "top_n": 4},
            "metrics": {
                "return_sharpe": 1.04,
                "out_of_sample_sharpe": 0.88,
                "total_return_pct": 13.0,
                "stability": 78.0,
            },
            "score": 1.42,
        },
    }
    stale_eta_result = {
        "headline": "Candidate 1",
        "summary": "Projection preserved from a prior runtime.",
        "status": "INTERRUPTED",
        "progress_pct": 25,
        "current_stage": "Interrupted at 1/4",
        "latest_update": "Progress preserved at 1/4. Click Continue Optimization to resume.",
        "estimated_remaining_minutes": 14,
        "estimated_completed_at": "2026-04-13T10:14:00Z",
    }

    service.storage.insert_json_row(
        "optimization_jobs",
        {
            "id": "opt_stale_eta_queued",
            "strategy_id": strategy["id"],
            "status": "QUEUED",
            "request_json": json.dumps(
                {
                    "objective": "sharpe",
                    "base_parameter_version_id": strategy["current_parameter_version_id"],
                    "source_run_id": strategy["latest_successful_run_id"],
                    "entry_point": "lab_menu",
                    "validation_mode": "walk_forward",
                    "budget_combinations": 4,
                    "status": "QUEUED",
                    "current_stage": "Preparing trial 2/4",
                    "latest_update": "Optimization job recreated from the previous configuration.",
                    "estimated_remaining_minutes": 14,
                    "estimated_completed_at": "2026-04-13T10:14:00Z",
                }
            ),
            "summary_json": json.dumps(
                {
                    **stale_eta_summary,
                    "status": "QUEUED",
                    "current_stage": "Preparing trial 2/4",
                    "latest_update": "Optimization job recreated from the previous configuration.",
                    "resume_ready": False,
                    "interrupted_reason": None,
                }
            ),
            "result_json": json.dumps(
                {
                    **stale_eta_result,
                    "status": "QUEUED",
                    "current_stage": "Preparing trial 2/4",
                    "latest_update": "Optimization job recreated from the previous configuration.",
                }
            ),
            "candidates_json": json.dumps([]),
            "created_at": created_at,
            "updated_at": "2026-04-13T10:01:00Z",
            "completed_at": None,
        },
    )
    service.storage.insert_json_row(
        "optimization_jobs",
        {
            "id": "opt_stale_eta_interrupted",
            "strategy_id": strategy["id"],
            "status": "INTERRUPTED",
            "request_json": json.dumps(
                {
                    "objective": "sharpe",
                    "base_parameter_version_id": strategy["current_parameter_version_id"],
                    "source_run_id": strategy["latest_successful_run_id"],
                    "entry_point": "lab_menu",
                    "validation_mode": "walk_forward",
                    "budget_combinations": 4,
                    "status": "INTERRUPTED",
                    "current_stage": "Interrupted at 1/4",
                    "latest_update": "Progress preserved at 1/4. Click Continue Optimization to resume.",
                    "estimated_remaining_minutes": 14,
                    "estimated_completed_at": "2026-04-13T10:14:00Z",
                    "interrupted_reason": "service_restart",
                }
            ),
            "summary_json": json.dumps(
                {
                    **stale_eta_summary,
                    "status": "INTERRUPTED",
                    "current_stage": "Interrupted at 1/4",
                    "latest_update": "Progress preserved at 1/4. Click Continue Optimization to resume.",
                    "resume_ready": True,
                    "interrupted_reason": "service_restart",
                }
            ),
            "result_json": json.dumps(stale_eta_result),
            "candidates_json": json.dumps([]),
            "created_at": created_at,
            "updated_at": "2026-04-13T10:01:00Z",
            "completed_at": None,
        },
    )

    jobs = assert_ok(client.get("/optimization-jobs"))
    listed = {item["id"]: item for item in jobs if item["id"] in {"opt_stale_eta_queued", "opt_stale_eta_interrupted"}}

    queued_detail = assert_ok(client.get("/optimization-jobs/opt_stale_eta_queued/detail"))
    interrupted_detail = assert_ok(client.get("/optimization-jobs/opt_stale_eta_interrupted/detail"))

    assert listed["opt_stale_eta_queued"]["status"] == "QUEUED"
    assert listed["opt_stale_eta_queued"]["estimated_remaining_minutes"] is None
    assert listed["opt_stale_eta_queued"]["estimated_completed_at"] is None
    assert queued_detail["summary"]["estimated_remaining_minutes"] is None
    assert queued_detail["summary"]["estimated_completed_at"] is None
    assert queued_detail["result"]["estimated_remaining_minutes"] is None
    assert queued_detail["result"]["estimated_completed_at"] is None

    assert listed["opt_stale_eta_interrupted"]["status"] == "INTERRUPTED"
    assert listed["opt_stale_eta_interrupted"]["estimated_remaining_minutes"] is None
    assert listed["opt_stale_eta_interrupted"]["estimated_completed_at"] is None
    assert interrupted_detail["summary"]["estimated_remaining_minutes"] is None
    assert interrupted_detail["summary"]["estimated_completed_at"] is None
    assert interrupted_detail["result"]["estimated_remaining_minutes"] is None
    assert interrupted_detail["result"]["estimated_completed_at"] is None


def test_delete_optimization_job_logically_hides_it_from_list_detail_and_workspace_refs(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    base = create_momentum_strategy(client, idempotency_key="optimization-delete-job")
    strategy = base["strategy"]
    first_job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        entry_point="lab_menu",
        validation_mode="walk_forward",
        budget_combinations=4,
    )
    second_job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        entry_point="run_detail",
        validation_mode="single_oos",
        budget_combinations=6,
    )

    deleted = assert_ok(client.delete(f"/optimization-jobs/{second_job['id']}"))
    listed_jobs = assert_ok(client.get("/optimization-jobs"))
    strategies = assert_ok(client.get("/strategies"))
    overview = assert_ok(client.get("/workspace/overview"))

    assert deleted["id"] == second_job["id"]
    assert deleted["deleted_reason"] == "user_deleted"
    assert deleted["deleted_at"]
    assert [item["id"] for item in listed_jobs] == [first_job["id"]]
    assert client.get(f"/optimization-jobs/{second_job['id']}/detail").status_code == 404

    deleted_row = service.storage.fetch_one(
        "SELECT id, deleted_at, deleted_reason FROM optimization_jobs WHERE id = ?",
        (second_job["id"],),
    )
    assert deleted_row is not None
    assert deleted_row["deleted_at"] is not None
    assert deleted_row["deleted_reason"] == "user_deleted"

    strategy_item = next(item for item in strategies if item["id"] == strategy["id"])
    assert strategy_item["latest_optimization_job_id"] == first_job["id"]
    assert overview["latest_optimization_job_id"] == first_job["id"]


def _test_optimization_scoring_uses_annualized_return_for_ranking_and_verdict(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    strong_metrics = {
        "return_sharpe": 1.05,
        "out_of_sample_sharpe": 0.85,
        "annualized_return": 0.12,
        "total_return_pct": 14.0,
        "max_drawdown_pct": -20.0,
        "stability": 75.0,
    }
    weak_metrics = dict(strong_metrics, annualized_return=0.05)

    strong_sharpe_score = service._score_optimization_metrics(strong_metrics, "sharpe")
    weak_sharpe_score = service._score_optimization_metrics(weak_metrics, "sharpe")
    strong_return_score = service._score_optimization_metrics(strong_metrics, "annualized_return")
    weak_return_score = service._score_optimization_metrics(weak_metrics, "annualized_return")

    assert strong_sharpe_score > weak_sharpe_score
    assert strong_return_score > weak_return_score
    assert service._optimization_status_label(strong_metrics) == "建议提升"
    assert service._optimization_status_label(weak_metrics) == "高风险"

    ranked = service._rank_optimization_trials(
        [
            {"score": weak_sharpe_score, "metrics": weak_metrics},
            {"score": strong_sharpe_score, "metrics": strong_metrics},
        ]
    )
    assert ranked[0]["metrics"]["annualized_return"] == strong_metrics["annualized_return"]


def _test_optimization_scoring_caps_total_return_bias_against_high_drawdown_outliers(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    balanced_metrics = {
        "return_sharpe": 1.08,
        "out_of_sample_sharpe": 0.88,
        "annualized_return": 0.12,
        "total_return_pct": 42.0,
        "max_drawdown_pct": -20.0,
        "stability": 78.0,
        "turnover": 0.08,
    }
    speculative_metrics = {
        "return_sharpe": 0.52,
        "out_of_sample_sharpe": 0.28,
        "annualized_return": 0.13,
        "total_return_pct": 520.0,
        "max_drawdown_pct": -62.0,
        "stability": 38.0,
        "turnover": 0.26,
    }

    balanced_score = service._score_optimization_metrics(balanced_metrics, "annualized_return")
    speculative_score = service._score_optimization_metrics(speculative_metrics, "annualized_return")

    assert balanced_score > speculative_score
    ranked = service._rank_optimization_trials(
        [
            {"score": speculative_score, "metrics": speculative_metrics},
            {"score": balanced_score, "metrics": balanced_metrics},
        ]
    )
    assert ranked[0]["metrics"]["max_drawdown_pct"] == balanced_metrics["max_drawdown_pct"]


def _test_optimization_validation_windows_include_annualized_return(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    chart_series = [
        {
            "trade_date": f"2026-01-{index + 1:02d}",
            "equity": 100.0 + index,
            "benchmark": 100.0,
            "drawdown": -float(index),
            "is_oos": index >= 4,
            "strategy_return": 0.01 + index * 0.002,
            "benchmark_return": 0.008 + index * 0.001,
        }
        for index in range(6)
    ]

    windows = service._build_optimization_validation_windows(chart_series, "walk_forward")

    assert windows
    assert all("annualized_return" in window for window in windows)
    assert all(window["verdict"] in {"pass", "watch", "risk"} for window in windows)


def test_optimization_ranking_uses_selected_objective_as_strict_primary_key(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    sharpe_first = {
        "return_sharpe": 1.42,
        "out_of_sample_sharpe": 0.91,
        "annualized_return": 0.11,
        "total_return_pct": 22.0,
        "max_drawdown_pct": -18.0,
        "stability": 77.0,
    }
    return_first = {
        "return_sharpe": 1.08,
        "out_of_sample_sharpe": 0.9,
        "annualized_return": 0.16,
        "total_return_pct": 28.0,
        "max_drawdown_pct": -19.0,
        "stability": 78.0,
    }
    score_first = {
        "return_sharpe": 1.18,
        "out_of_sample_sharpe": 0.97,
        "annualized_return": 0.13,
        "total_return_pct": 25.0,
        "max_drawdown_pct": -16.0,
        "stability": 84.0,
    }

    ranked_by_sharpe = service._rank_optimization_trials(
        [
            {"trial_index": 1, "score": 96.0, "metrics": sharpe_first},
            {"trial_index": 2, "score": 94.0, "metrics": return_first},
            {"trial_index": 3, "score": 99.0, "metrics": score_first},
        ],
        "return_sharpe",
    )
    ranked_by_return = service._rank_optimization_trials(
        [
            {"trial_index": 1, "score": 96.0, "metrics": sharpe_first},
            {"trial_index": 2, "score": 94.0, "metrics": return_first},
            {"trial_index": 3, "score": 99.0, "metrics": score_first},
        ],
        "annualized_return",
    )
    ranked_by_score = service._rank_optimization_trials(
        [
            {"trial_index": 1, "score": 96.0, "metrics": sharpe_first},
            {"trial_index": 2, "score": 94.0, "metrics": return_first},
            {"trial_index": 3, "score": 99.0, "metrics": score_first},
        ],
        "composite_score",
    )

    assert ranked_by_sharpe[0]["metrics"]["return_sharpe"] == sharpe_first["return_sharpe"]
    assert ranked_by_return[0]["metrics"]["annualized_return"] == return_first["annualized_return"]
    assert ranked_by_score[0]["score"] == 99.0


def test_optimization_composite_score_ignores_removed_turnover_factor_and_penalizes_outliers(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    balanced_metrics = {
        "return_sharpe": 1.08,
        "out_of_sample_sharpe": 0.88,
        "annualized_return": 0.12,
        "total_return_pct": 42.0,
        "max_drawdown_pct": -20.0,
        "stability": 78.0,
        "turnover": 0.08,
    }
    speculative_metrics = {
        "return_sharpe": 0.52,
        "out_of_sample_sharpe": 0.28,
        "annualized_return": 0.12,
        "total_return_pct": 520.0,
        "max_drawdown_pct": -62.0,
        "stability": 38.0,
        "turnover": 0.26,
    }

    balanced_score = service._score_optimization_metrics(balanced_metrics, "composite_score")
    speculative_score = service._score_optimization_metrics(speculative_metrics, "composite_score")

    assert balanced_score > speculative_score
    ranked = service._rank_optimization_trials(
        [
            {"trial_index": 1, "score": speculative_score, "metrics": speculative_metrics},
            {"trial_index": 2, "score": balanced_score, "metrics": balanced_metrics},
        ],
        "composite_score",
    )
    assert ranked[0]["score"] == balanced_score


def test_optimization_validation_windows_include_period_labels_and_annualized_return(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    chart_series = [
        {
            "trade_date": f"2026-01-{index + 1:02d}",
            "equity": 100.0 + index,
            "benchmark": 100.0,
            "drawdown": -float(index),
            "is_oos": index >= 4,
            "strategy_return": 0.01 + index * 0.002,
            "benchmark_return": 0.008 + index * 0.001,
        }
        for index in range(6)
    ]

    windows = service._build_optimization_validation_windows(chart_series, "walk_forward")

    assert windows
    assert all("annualized_return" in window for window in windows)
    assert all(isinstance(window["annualized_return"], float) for window in windows)
    assert all(window.get("period_label") for window in windows)
    assert windows[0]["period_label"] == "2026-01-01 至 2026-01-02"
    assert all(window["verdict"] in {"pass", "watch", "risk"} for window in windows)


def test_real_optimization_candidate_analysis_uses_chinese_copy(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    analysis = service._build_real_optimization_candidate_analysis(
        title="候选 1",
        metrics={
            "annualized_return": 0.129,
            "return_sharpe": 1.12,
            "out_of_sample_sharpe": 0.91,
            "max_drawdown_pct": -12.6,
            "stability": 82.0,
        },
        search_space=[
            {"key": "lookback_months", "label": "回看(月)", "mode": "range", "start": 6, "end": 12, "step": 1},
            {"key": "top_n", "label": "买入排名阈值", "mode": "range", "start": 10, "end": 100, "step": 10},
        ],
        parameter_snapshot={"lookback_months": 6, "top_n": 20},
        validation_mode="walk_forward",
        chart_series=[],
        evaluated_trials=[],
        status_label="建议提升",
    )

    assert analysis["stability_summary"].startswith("该候选已满足核心晋升护栏")
    assert analysis["stability_checks"][0]["label"] == "年化收益率"
    assert analysis["stability_checks"][0]["detail"] == "年化收益率已达到正式版本晋升评估的收益门槛。"
    assert analysis["stability_checks"][1]["label"] == "收益夏普"


def test_normalize_optimization_candidate_localizes_legacy_english_analysis(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    strategy = create_momentum_strategy(client, idempotency_key="optimization-analysis-localization")["strategy"]

    candidate = service._normalize_optimization_candidate(
        strategy,
        {
            "id": "trial-legacy-1",
            "label": "Candidate 1",
            "status": "SUCCEEDED",
            "rank": 1,
            "metrics": {"annualized_return": 0.129, "return_sharpe": 1.12},
            "analysis": {
                "stability_summary": (
                    "This candidate already meets the core promotion guardrails. "
                    "Use the validation windows to confirm the edge persists across different market regimes."
                ),
                "stability_checks": [
                    {
                        "key": "annualized_return",
                        "label": "Annualized Return",
                        "value": 12.9,
                        "verdict": "pass",
                        "detail": "Annualized return is strong enough to support promotion review.",
                    }
                ],
            },
        },
        rank=1,
        base_parameter_version_id=strategy["current_parameter_version_id"],
    )

    assert candidate["analysis"]["stability_summary"].startswith("该候选已满足核心晋升护栏")
    assert candidate["analysis"]["stability_checks"][0]["label"] == "年化收益率"
    assert candidate["analysis"]["stability_checks"][0]["detail"] == "年化收益率已达到正式版本晋升评估的收益门槛。"


def test_optimization_heatmap_cells_include_selected_metric_values(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    search_space = [
        {"key": "lookback_months", "label": "观察周期", "mode": "range", "start": 6, "end": 8, "step": 1, "current": 7},
        {"key": "top_n", "label": "持仓数量", "mode": "range", "start": 10, "end": 12, "step": 1, "current": 11},
    ]
    focus = {"lookback_months": 7, "top_n": 11}
    metrics = {
        "annualized_return": 0.124,
        "return_sharpe": 1.18,
        "max_drawdown_pct": -12.6,
    }

    heatmap = service._build_optimization_heatmap(search_space, focus, 1.18, metrics)

    assert heatmap["cells"]
    assert all("metrics" in cell for cell in heatmap["cells"])
    assert all("annualized_return" in cell["metrics"] for cell in heatmap["cells"])
    assert all("return_sharpe" in cell["metrics"] for cell in heatmap["cells"])
    assert all("max_drawdown_pct" in cell["metrics"] for cell in heatmap["cells"])


def test_optimization_first_paint_heatmap_keeps_scores_without_cell_metrics(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    compact = service._compact_optimization_candidate_heatmap_for_first_paint(
        {
            "id": "trial_1",
            "analysis": {
                "heatmap": {
                    "x_key": "lookback_months",
                    "y_key": "top_n",
                    "x_values": [6, 7],
                    "y_values": [10, 11],
                    "cells": [
                        {
                            "x": 7,
                            "y": 11,
                            "score": 1.18,
                            "metrics": {
                                "annualized_return": 0.124,
                                "return_sharpe": 1.18,
                                "max_drawdown_pct": -12.6,
                            },
                            "is_candidate": True,
                            "tone": "hot",
                        }
                    ],
                }
            },
        }
    )

    cell = compact["analysis"]["heatmap"]["cells"][0]
    assert cell == {"x": 7, "y": 11, "score": 1.18, "is_candidate": True, "tone": "hot"}


def test_list_optimization_jobs_purges_legacy_mock_rows(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    base = create_momentum_strategy(client, idempotency_key="materialize-optimization-list-purge")
    strategy = base["strategy"]
    real_job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=4,
        search_space=[
            {"key": "lookback_months", "label": "观察周期", "mode": "range", "start": 5, "end": 6, "step": 1, "current": 6},
            {"key": "top_n", "label": "持仓数量", "mode": "range", "start": 3, "end": 4, "step": 1, "current": 4},
        ],
    )
    now = datetime.now(timezone.utc).replace(microsecond=0)

    service.storage.insert_json_row(
        "optimization_jobs",
        {
            "id": "opt_legacy_mock",
            "strategy_id": strategy["id"],
            "status": "COMPLETED",
            "request_json": json.dumps(
                {
                    "base_parameter_version_id": strategy["current_parameter_version_id"],
                    "budget_combinations": 70,
                    "validation_mode": "walk_forward",
                }
            ),
            "summary_json": json.dumps({"budget_combinations": 70}),
            "result_json": json.dumps(
                {
                    "headline": "稳定策略中心",
                    "best_candidate_label": "稳定策略中心",
                }
            ),
            "candidates_json": json.dumps(
                [
                    {"id": "trial_legacy_1", "label": "稳定策略中心"},
                    {"id": "trial_legacy_2", "label": "防守优先级"},
                    {"id": "trial_legacy_3", "label": "收益增益版"},
                    {"id": "trial_legacy_4", "label": "边界试验版"},
                ]
            ),
            "created_at": (now + timedelta(seconds=1)).isoformat().replace("+00:00", "Z"),
            "updated_at": (now + timedelta(seconds=1)).isoformat().replace("+00:00", "Z"),
            "completed_at": (now + timedelta(seconds=1)).isoformat().replace("+00:00", "Z"),
        },
    )
    service.storage.insert_json_row(
        "optimization_jobs",
        {
            "id": "opt_legacy_placeholder",
            "strategy_id": strategy["id"],
            "status": "COMPLETED",
            "request_json": json.dumps({"base_parameter_version_id": strategy["current_parameter_version_id"]}),
            "summary_json": json.dumps({"candidate_count": 1}),
            "result_json": json.dumps({"best_candidate_id": "trial_legacy_baseline"}),
            "candidates_json": json.dumps(
                [
                    {
                        "id": "trial_legacy_baseline",
                        "label": "Baseline + 1",
                        "metrics": {},
                    }
                ]
            ),
            "created_at": (now + timedelta(seconds=2)).isoformat().replace("+00:00", "Z"),
            "updated_at": (now + timedelta(seconds=2)).isoformat().replace("+00:00", "Z"),
            "completed_at": (now + timedelta(seconds=2)).isoformat().replace("+00:00", "Z"),
        },
    )

    jobs = assert_ok(client.get("/optimization-jobs"))
    job_ids = [item["id"] for item in jobs]

    assert real_job["id"] in job_ids
    assert "opt_legacy_mock" not in job_ids
    assert "opt_legacy_placeholder" not in job_ids
    assert service.storage.fetch_one("SELECT id FROM optimization_jobs WHERE id = ?", ("opt_legacy_mock",)) is None
    assert (
        service.storage.fetch_one("SELECT id FROM optimization_jobs WHERE id = ?", ("opt_legacy_placeholder",))
        is None
    )
    assert client.get("/optimization-jobs/opt_legacy_mock/detail").status_code == 404


def test_optimization_job_detail_repairs_garbled_best_candidate_labels(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    base = create_momentum_strategy(client, idempotency_key="optimization-garbled-best-candidate")
    strategy = base["strategy"]
    job_id = "opt_garbled_best_candidate"
    created_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    garbled_label = "?\uea57\u0080?1"

    service.storage.insert_json_row(
        "optimization_jobs",
        {
            "id": job_id,
            "strategy_id": strategy["id"],
            "status": "COMPLETED",
            "request_json": json.dumps({"base_parameter_version_id": strategy["current_parameter_version_id"]}),
            "summary_json": json.dumps(
                {
                    "status": "COMPLETED",
                    "budget_combinations": 4,
                    "completed_combinations": 4,
                    "best_metrics_summary": {
                        "trial_index": 1,
                        "label": "Trial 1",
                        "status": "SUCCEEDED",
                        "metrics": {"return_sharpe": 1.18},
                    },
                }
            ),
            "result_json": json.dumps(
                {
                    "status": "COMPLETED",
                    "best_candidate_id": "trial_garbled_1",
                    "best_candidate_label": garbled_label,
                    "headline": "Best candidate",
                    "summary": "Optimization completed.",
                }
            ),
            "candidates_json": json.dumps(
                [
                    {
                        "id": "trial_garbled_1",
                        "label": garbled_label,
                        "rank": 1,
                        "status": "SUCCEEDED",
                        "score": 1.18,
                        "metrics": {"return_sharpe": 1.18},
                        "parameter_snapshot": strategy["parameters"],
                        "parameter_delta": {},
                        "allowed_actions": ["promote_candidate", "create_copy"],
                    },
                    {
                        "id": "trial_garbled_2",
                        "label": "?\uea57\u0080?2",
                        "rank": 2,
                        "status": "SUCCEEDED",
                        "score": 1.02,
                        "metrics": {"return_sharpe": 1.02},
                        "parameter_snapshot": strategy["parameters"],
                        "parameter_delta": {},
                        "allowed_actions": ["promote_candidate", "create_copy"],
                    },
                ]
            ),
            "created_at": created_at,
            "updated_at": created_at,
            "completed_at": created_at,
        },
    )

    detail = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail"))
    jobs = assert_ok(client.get("/optimization-jobs"))
    listed = next(item for item in jobs if item["id"] == job_id)

    assert detail["candidates"][0]["label"] == "候选 1"
    assert detail["candidates"][1]["label"] == "候选 2"
    assert detail["result"]["best_candidate_label"] == "候选 1"
    assert detail["summary"]["best_metrics_summary"]["label"] == "候选 1"
    assert listed["best_candidate_label"] == "候选 1"
    assert listed["best_metrics_summary"]["label"] == "候选 1"


def test_create_optimization_job_returns_running_progress_before_results_are_ready(tmp_path):
    client, _ = create_test_client(tmp_path)

    refresh_snapshots(client, mode="repair", targets=["price", "corporate", "universes"])
    base = create_momentum_strategy(client, idempotency_key="materialize-optimization-progress")
    strategy = base["strategy"]
    search_space = [
        {"key": "lookback_months", "label": "观察周期", "mode": "range", "start": 4, "end": 6, "step": 1, "current": 6},
        {"key": "top_n", "label": "持仓数量", "mode": "range", "start": 3, "end": 4, "step": 1, "current": 4},
    ]
    created = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=6,
        search_space=search_space,
        wait_until_complete=False,
    )

    assert created["status"] in {"QUEUED", "RUNNING"}
    assert created["completed_at"] is None
    assert created["summary"]["progress_pct"] < 100
    assert created["summary"]["completed_combinations"] < 6
    assert created["summary"]["current_stage"]
    assert created["summary"]["latest_update"]
    assert created["result"]["headline"]

    completed = wait_for_optimization_job(client, created["id"])

    assert completed["status"] == "COMPLETED"
    assert completed["completed_at"] is not None
    assert completed["summary"]["progress_pct"] == 100
    assert completed["summary"]["completed_combinations"] == 6
    assert completed["summary"]["persisted_trial_count"] == 6
    assert completed["summary"]["next_trial_index"] == 7
    assert completed["summary"]["resume_ready"] is False
    assert completed["summary"]["latest_update"]
    assert completed["result"]["best_candidate_id"] is not None
    assert completed["result"]["best_candidate_label"] is not None
    assert completed["candidates"]


def test_create_optimization_job_marks_running_before_first_trial_finishes(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})

    base = create_momentum_strategy(client, idempotency_key="materialize-optimization-live-progress")
    strategy = base["strategy"]

    def slow_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        time.sleep(0.2)
        return {
            "parameter_snapshot": dict(parameter_snapshot),
            "metrics": {
                "total_return": 0.1,
                "cagr": 0.1,
                "annualized_return": 0.1,
                "annualized_volatility": 0.05,
                "sharpe": 1.2,
                "max_drawdown": -0.05,
                "turnover": 0.0,
                "win_rate": 0.6,
                "oos_cagr": 0.09,
                "oos_sharpe": 1.1,
                "total_return_pct": 10.0,
                "return_sharpe": 1.2,
                "out_of_sample_sharpe": 1.1,
                "max_drawdown_pct": -5.0,
                "stability": 80.0,
            },
            "chart_series": [
                {
                    "trade_date": "2026-01-01",
                    "equity": 100.0,
                    "benchmark": 100.0,
                    "drawdown": 0.0,
                    "is_oos": False,
                    "strategy_return": 0.0,
                    "benchmark_return": 0.0,
                }
            ],
            "score": 1.2,
        }

    monkeypatch.setattr(service, "_evaluate_optimization_trial", slow_trial)

    created = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=4,
        search_space=[
            {"key": "lookback_months", "label": "观察周期", "mode": "range", "start": 5, "end": 6, "step": 1, "current": 6},
            {"key": "top_n", "label": "持仓数量", "mode": "range", "start": 3, "end": 4, "step": 1, "current": 4},
        ],
        wait_until_complete=False,
    )

    deadline = time.monotonic() + 1.0
    running = created
    while time.monotonic() < deadline:
        running = assert_ok(client.get(f"/optimization-jobs/{created['id']}/detail"))
        if (
            running["status"] == "RUNNING"
            and running["summary"]["completed_combinations"] == 0
            and str(running["summary"]["current_stage"]).startswith("Running trial 1/4")
        ):
            break
        time.sleep(0.01)

    assert running["status"] == "RUNNING"
    assert running["summary"]["completed_combinations"] == 0
    assert running["summary"]["current_stage"] == "Running trial 1/4"
    assert "Evaluating" in str(running["summary"]["latest_update"])
    assert running["summary"]["estimated_remaining_minutes"] is None
    assert running["summary"]["estimated_completed_at"] is None
    assert running["candidates"] == []


def test_resume_incomplete_optimization_jobs_restarts_running_progress_and_preserves_detail_projection(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})

    base = create_momentum_strategy(client, idempotency_key="materialize-optimization-recovery")
    strategy = base["strategy"]

    search_space = [
        {"key": "lookback_months", "label": "观察周期", "mode": "range", "start": 5, "end": 6, "step": 1, "current": 6},
        {"key": "top_n", "label": "持仓数量", "mode": "range", "start": 3, "end": 4, "step": 1, "current": 4},
    ]
    stale_updated_at = "2026-04-10T11:01:59Z"
    job_id = "opt_resume_running"
    payload = {
        "objective": "sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "source_run_id": strategy["latest_successful_run_id"],
        "entry_point": "lab_menu",
        "validation_mode": "walk_forward",
        "budget_combinations": 4,
        "search_space": search_space,
        "status": "RUNNING",
        "progress_pct": 50,
        "completed_combinations": 2,
        "current_stage": "评估组合 2/4",
        "latest_update": "已完成 2 / 4 组，最近评估 观察周期=6 / 持仓数量=3。",
    }
    service.storage.insert_json_row(
        "optimization_jobs",
        {
            "id": job_id,
            "strategy_id": strategy["id"],
            "status": "RUNNING",
            "request_json": json.dumps(payload, ensure_ascii=False),
            "summary_json": json.dumps(
                {
                    "status": "RUNNING",
                    "budget_combinations": 4,
                    "completed_combinations": 2,
                    "progress_pct": 50,
                },
                ensure_ascii=False,
            ),
            "result_json": json.dumps(
                {
                    "status": "RUNNING",
                    "progress_pct": 50,
                    "headline": "优化进行中",
                    "summary": payload["latest_update"],
                },
                ensure_ascii=False,
            ),
            "candidates_json": json.dumps([], ensure_ascii=False),
            "created_at": "2026-04-10T10:53:42Z",
            "updated_at": stale_updated_at,
            "completed_at": None,
        },
    )
    planned_snapshots = service._plan_optimization_search_snapshots(
        dict(strategy.get("parameters") or {}),
        search_space,
        4,
    )
    for trial_index, parameter_snapshot in enumerate(planned_snapshots[:2], start=1):
        service._persist_optimization_trial(
            job_id,
            trial_index,
            status="SUCCEEDED",
            parameter_snapshot=parameter_snapshot,
            metrics={
                "sharpe": 1.1 + trial_index / 10.0,
                "return_sharpe": 1.1 + trial_index / 10.0,
                "out_of_sample_sharpe": 1.0 + trial_index / 10.0,
                "max_drawdown_pct": -5.0,
                "stability": 80.0,
                "total_return_pct": 10.0 + trial_index,
            },
            chart_series=[
                {
                    "trade_date": "2026-01-01",
                    "equity": 100.0 + trial_index,
                    "benchmark": 100.0,
                    "drawdown": 0.0,
                    "is_oos": False,
                    "strategy_return": 0.0,
                    "benchmark_return": 0.0,
                }
            ],
            score=1.1 + trial_index / 10.0,
            error_message=None,
            started_at=stale_updated_at,
            completed_at=stale_updated_at,
        )

    def fake_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
        *,
        prepared_context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        trial_index = int(payload.get("completed_combinations") or 0) + 1
        return {
            "parameter_snapshot": dict(parameter_snapshot),
            "metrics": {
                "sharpe": 1.4 + trial_index / 10.0,
                "return_sharpe": 1.4 + trial_index / 10.0,
                "out_of_sample_sharpe": 1.1 + trial_index / 10.0,
                "max_drawdown_pct": -5.0,
                "stability": 82.0,
                "total_return_pct": 12.0 + trial_index,
            },
            "chart_series": [
                {
                    "trade_date": "2026-01-01",
                    "equity": 100.0 + trial_index,
                    "benchmark": 100.0,
                    "drawdown": 0.0,
                    "is_oos": False,
                    "strategy_return": 0.0,
                    "benchmark_return": 0.0,
                }
            ],
            "score": 1.4 + trial_index / 10.0,
        }

    monkeypatch.setattr(service, "_evaluate_optimization_trial", fake_trial)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

    resumed = service.resume_incomplete_optimization_jobs()

    assert resumed == [job_id]

    recovering = wait_for_optimization_job(client, job_id)
    assert recovering["updated_at"] != stale_updated_at
    assert recovering["status"] == "COMPLETED"
    assert recovering["summary"]["completed_combinations"] == 4
    assert recovering["summary"]["persisted_trial_count"] == 4
    assert recovering["summary"]["next_trial_index"] == 5
    assert recovering["summary"]["resume_ready"] is False
    assert recovering["summary"].get("interrupted_reason") is None
    assert recovering["persisted_trial_count"] == 4
    assert recovering["next_trial_index"] == 5
    assert recovering["resume_ready"] is False
    assert recovering["interrupted_reason"] is None
    assert recovering["completed_at"] is not None


def test_create_optimization_job_persists_configured_request_and_result_projection(tmp_path):
    client, _ = create_test_client(tmp_path)

    refresh_snapshots(client, mode="repair", targets=["price", "corporate", "universes"])
    base = create_momentum_strategy(client, idempotency_key="materialize-optimization-configured")
    strategy = base["strategy"]
    created = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        entry_point="run_detail",
        source_run_id=strategy["latest_successful_run_id"],
        validation_mode="walk_forward",
        budget_combinations=20,
        search_space=[
            {"key": "lookback_months", "label": "观察窗口", "mode": "range", "start": "4", "end": "8", "step": "1", "current": 6},
            {"key": "top_n", "label": "持仓数量", "mode": "range", "start": "1", "end": "4", "step": "1", "current": 1},
        ],
    )

    assert created["request"]["entry_point"] == "run_detail"
    assert created["request"]["source_run_id"] == strategy["latest_successful_run_id"]
    assert created["request"]["validation_mode"] == "walk_forward"
    assert created["request"]["budget_combinations"] == 20
    assert created["request"]["search_space"][0]["key"] == "lookback_months"
    assert created["status"] == "COMPLETED"
    assert created["summary"]["candidate_count"] > 0
    assert created["summary"]["completed_combinations"] == 20
    assert created["summary"]["persisted_trial_count"] == 20
    assert created["summary"]["next_trial_index"] == 21
    assert created["summary"]["resume_ready"] is False
    assert created["summary"]["validation_mode"] == "walk_forward"
    assert created["result"]["best_candidate_id"] is not None
    assert created["result"]["best_candidate_label"] is not None
    assert created["summary"]["best_metrics_summary"] is not None
    assert created["candidates"]


def test_optimization_search_space_supports_discrete_enum_values(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    normalized = service._normalize_optimization_search_space(
        {"parameters": {"observation_timeframe": "daily"}},
        {
            "search_space": [
                {
                    "key": "observation_timeframe",
                    "label": "观察周期",
                    "mode": "discrete",
                    "current": "daily",
                    "value": "daily",
                    "values": ["daily", "weekly", "monthly"],
                }
            ]
        },
    )

    assert normalized == [
        {
            "key": "observation_timeframe",
            "label": "观察周期",
            "mode": "discrete",
            "current": "daily",
            "start": "daily",
            "end": "daily",
            "step": None,
            "value": "daily",
            "values": ["daily", "weekly", "monthly"],
            "tag": None,
        }
    ]
    assert service._optimization_field_values(normalized[0], "daily") == [
        "daily",
        "weekly",
        "monthly",
    ]
    assert service._plan_optimization_search_snapshots(
        {"observation_timeframe": "daily"},
        normalized,
        3,
    ) == [
        {"observation_timeframe": "daily"},
        {"observation_timeframe": "weekly"},
        {"observation_timeframe": "monthly"},
    ]


def test_optimization_search_space_supports_momentum_rebalance_frequency_enum_values(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    normalized = service._normalize_optimization_search_space(
        {"parameters": {"rebalance_frequency": "semiannual"}},
        {
            "search_space": [
                {
                    "key": "rebalance_frequency",
                    "label": "调仓频率",
                    "mode": "discrete",
                    "current": "semiannual",
                    "value": "semiannual",
                    "values": ["monthly", "quarterly", "semiannual", "yearly"],
                }
            ]
        },
    )

    assert normalized == [
        {
            "key": "rebalance_frequency",
            "label": "调仓频率",
            "mode": "discrete",
            "current": "semiannual",
            "start": "semiannual",
            "end": "semiannual",
            "step": None,
            "value": "semiannual",
            "values": ["monthly", "quarterly", "semiannual", "yearly"],
            "tag": None,
        }
    ]
    assert service._optimization_field_values(normalized[0], "semiannual") == [
        "monthly",
        "quarterly",
        "semiannual",
        "yearly",
    ]
    assert service._plan_optimization_search_snapshots(
        {"rebalance_frequency": "semiannual"},
        normalized,
        4,
    ) == [
        {"rebalance_frequency": "monthly"},
        {"rebalance_frequency": "quarterly"},
        {"rebalance_frequency": "semiannual"},
        {"rebalance_frequency": "yearly"},
    ]


def test_optimization_search_space_filters_asset_allocation_weight_sum(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service

    normalized = service._normalize_optimization_search_space(
        {
            "strategy_type": "ASSET_ALLOCATION",
            "parameters": {
                "allocation_weight__SPY_pct": 50,
                "allocation_weight__TLT_pct": 50,
                "rebalance_frequency": "quarterly",
            },
        },
        {
            "search_space": [
                {
                    "key": "allocation_weight__SPY_pct",
                    "label": "SPY权重(%)",
                    "mode": "range",
                    "start": 50,
                    "end": 60,
                    "step": 10,
                    "current": 50,
                },
                {
                    "key": "allocation_weight__TLT_pct",
                    "label": "TLT权重(%)",
                    "mode": "range",
                    "start": 40,
                    "end": 50,
                    "step": 10,
                    "current": 50,
                },
                {
                    "key": "rebalance_frequency",
                    "label": "再平衡频率",
                    "mode": "discrete",
                    "current": "quarterly",
                    "value": "quarterly",
                    "values": ["monthly", "quarterly"],
                },
            ],
        },
    )

    weight_fields = [item for item in normalized if item["key"].startswith("allocation_weight__")]
    assert len(weight_fields) == 2
    assert all(item["constraint_group"] == "allocation_weight_sum_100" for item in weight_fields)
    assert all(item["constraint_target"] == 100.0 for item in weight_fields)

    snapshots = service._plan_optimization_search_snapshots(
        {
            "allocation_weight__SPY_pct": 50,
            "allocation_weight__TLT_pct": 50,
            "rebalance_frequency": "quarterly",
        },
        normalized,
        100,
    )

    assert len(snapshots) == 4
    assert {
        (
            item["allocation_weight__SPY_pct"],
            item["allocation_weight__TLT_pct"],
            item["rebalance_frequency"],
        )
        for item in snapshots
    } == {
        (50, 50, "monthly"),
        (50, 50, "quarterly"),
        (60, 40, "monthly"),
        (60, 40, "quarterly"),
    }
    assert all(
        item["allocation_weight__SPY_pct"] + item["allocation_weight__TLT_pct"] == 100
        for item in snapshots
    )


def test_completed_optimization_job_detail_uses_trial_rows_as_progress_truth(tmp_path):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})

    base = create_momentum_strategy(client, idempotency_key="materialize-optimization-progress-truth")
    strategy = base["strategy"]
    created_at = "2026-04-13T07:20:21Z"
    completed_at = "2026-04-13T07:21:25Z"
    job_id = "opt_completed_progress_truth"
    search_space = [
        {"key": "lookback_months", "label": "閫??冽?", "mode": "range", "start": 6, "end": 24, "step": 1, "current": 6},
        {"key": "skip_recent_months", "label": "銝?銝虫?", "mode": "range", "start": 1, "end": 3, "step": 1, "current": 1},
        {"key": "top_n", "label": "???圈?", "mode": "range", "start": 10, "end": 200, "step": 10, "current": 10},
        {
            "key": "hold_rank_threshold",
            "label": "?曄?圈?湧?銝虫?",
            "mode": "range",
            "start": 110,
            "end": 150,
            "step": 10,
            "current": 120,
        },
    ]
    payload = {
        "objective": "sharpe",
        "base_parameter_version_id": strategy["current_parameter_version_id"],
        "source_run_id": strategy["latest_successful_run_id"],
        "entry_point": "run_detail",
        "validation_mode": "walk_forward",
        "budget_combinations": 5700,
        "search_space": search_space,
        "status": "COMPLETED",
        "progress_pct": 100,
        "completed_combinations": 5700,
        "persisted_trial_count": 4,
        "next_trial_index": 5701,
        "current_stage": "Result ready",
        "latest_update": "Optimization completed.",
        "resume_ready": False,
    }
    service._persist_optimization_job(
        job_id,
        strategy["id"],
        payload,
        [],
        created_at=created_at,
        updated_at=completed_at,
        completed_at=completed_at,
    )

    planned_snapshots = service._plan_optimization_search_snapshots(
        dict(strategy.get("parameters") or {}),
        search_space,
        4,
    )
    for trial_index, snapshot in enumerate(planned_snapshots[:4], start=1):
        service._persist_optimization_trial(
            job_id,
            trial_index,
            status="SUCCEEDED",
            parameter_snapshot=snapshot,
            metrics={
                "sharpe": 1.0 + trial_index / 10.0,
                "return_sharpe": 1.0 + trial_index / 10.0,
                "out_of_sample_sharpe": 0.9 + trial_index / 10.0,
                "max_drawdown_pct": -5.0,
                "stability": 80.0,
                "total_return_pct": 10.0 + trial_index,
            },
            chart_series=[
                {
                    "trade_date": "2026-01-01",
                    "equity": 100.0 + trial_index,
                    "benchmark": 100.0,
                    "drawdown": 0.0,
                    "is_oos": False,
                    "strategy_return": 0.0,
                    "benchmark_return": 0.0,
                }
            ],
            score=1.0 + trial_index / 10.0,
            error_message=None,
            started_at=f"2026-04-13T07:21:2{trial_index - 1}Z",
            completed_at=f"2026-04-13T07:21:2{trial_index - 1}Z",
        )

    detail = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail"))

    assert detail["status"] == "COMPLETED"
    assert detail["summary"]["completed_combinations"] == 4
    assert detail["summary"]["persisted_trial_count"] == 4
    assert detail["summary"]["next_trial_index"] == 5
    assert detail["summary"]["estimated_remaining_minutes"] == 0
    assert detail["summary"]["estimated_completed_at"] == completed_at


def test_create_optimization_job_reuses_source_run_request_window(tmp_path):
    client, _ = create_test_client(tmp_path)

    refresh_snapshots(client, mode="repair", targets=["price", "corporate", "universes"])
    base = create_momentum_strategy(client, idempotency_key="materialize-optimization-source-window")
    strategy = base["strategy"]
    start_date = "2024-03-01"
    end_date = "2025-03-31"
    source_run = submit_backtest(
        client,
        strategy["id"],
        start_date=start_date,
        end_date=end_date,
        parameter_version_id=strategy["current_parameter_version_id"],
        idempotency_key="run-optimization-source-window",
    )
    preview = preview_backtest(
        client,
        strategy["id"],
        start_date=start_date,
        end_date=end_date,
        parameter_version_id=strategy["current_parameter_version_id"],
    )
    search_space = [
        {
            "key": "lookback_months",
            "label": "Lookback",
            "mode": "fixed",
            "current": strategy["parameters"]["lookback_months"],
            "value": strategy["parameters"]["lookback_months"],
        },
        {
            "key": "skip_recent_months",
            "label": "Skip Recent",
            "mode": "fixed",
            "current": strategy["parameters"]["skip_recent_months"],
            "value": strategy["parameters"]["skip_recent_months"],
        },
        {
            "key": "top_n",
            "label": "Top N",
            "mode": "fixed",
            "current": strategy["parameters"]["top_n"],
            "value": strategy["parameters"]["top_n"],
        },
        {
            "key": "hold_rank_threshold",
            "label": "Hold Rank Threshold",
            "mode": "fixed",
            "current": strategy["parameters"]["hold_rank_threshold"],
            "value": strategy["parameters"]["hold_rank_threshold"],
        },
        {
            "key": "weighting_method",
            "label": "Weighting",
            "mode": "fixed",
            "current": strategy["parameters"]["weighting_method"],
            "value": strategy["parameters"]["weighting_method"],
        },
    ]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        source_run_id=source_run["id"],
        validation_mode="walk_forward",
        budget_combinations=1,
        search_space=search_space,
        timeout_seconds=15.0,
    )

    service = client.app.state.service
    trial_row = service.storage.fetch_one(
        """
        SELECT metrics_json, chart_series_json
        FROM optimization_job_trials
        WHERE job_id = ? AND trial_index = 1
        """,
        (job["id"],),
    )
    assert trial_row is not None
    chart_series = json.loads(trial_row["chart_series_json"])
    metrics = json.loads(trial_row["metrics_json"])

    assert chart_series
    assert chart_series[0]["trade_date"] >= start_date
    assert chart_series[-1]["trade_date"] <= end_date
    assert abs(metrics["max_drawdown"] - preview["metrics"]["max_drawdown"]) < 0.05
    assert abs(metrics["return_sharpe"] - preview["metrics"]["sharpe"]) < 0.1


def test_create_optimization_job_candidates_use_real_backtest_metrics(tmp_path):
    client, _ = create_test_client(tmp_path)

    refresh_snapshots(client, mode="repair", targets=["price", "corporate", "universes"])
    base = create_momentum_strategy(client, idempotency_key="materialize-optimization-real-metrics")
    strategy = base["strategy"]
    search_space = [
        {"key": "lookback_months", "label": "观察周期", "mode": "range", "start": 5, "end": 6, "step": 1, "current": 6},
        {"key": "top_n", "label": "持仓数量", "mode": "range", "start": 3, "end": 4, "step": 1, "current": 4},
    ]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        source_run_id=strategy["latest_successful_run_id"],
        validation_mode="walk_forward",
        budget_combinations=4,
        search_space=search_space,
        timeout_seconds=15.0,
    )

    service = client.app.state.service
    source_run_id = strategy.get("latest_successful_run_id")
    source_run = service.get_backtest_run_detail(source_run_id) if source_run_id else None
    strategy_detail = service.get_strategy_detail(strategy["id"])
    evaluation_request = service._build_optimization_evaluation_request(strategy_detail, source_run=source_run)
    candidate = job["candidates"][0]
    effective_strategy = service._optimization_effective_strategy(strategy_detail, candidate["parameter_snapshot"])
    preview, chart_series, _ = service._simulate_run(effective_strategy, evaluation_request)
    expected_metrics = service._build_real_optimization_metrics(preview, chart_series)
    expected_score = service._score_optimization_metrics(expected_metrics, job["request"].get("objective"))
    evaluated = service._evaluate_optimization_trial(
        strategy_detail,
        evaluation_request,
        job["request"],
        candidate["parameter_snapshot"],
    )

    assert abs(candidate["metrics"]["sharpe"] - expected_metrics["sharpe"]) < 1e-9
    assert abs(candidate["metrics"]["total_return"] - expected_metrics["total_return"]) < 1e-9
    assert abs(candidate["metrics"]["max_drawdown"] - expected_metrics["max_drawdown"]) < 1e-9
    assert abs(candidate["metrics"]["out_of_sample_sharpe"] - expected_metrics["out_of_sample_sharpe"]) < 1e-9
    assert abs(candidate["score"] - expected_score) < 1e-9
    assert abs(evaluated["metrics"]["sharpe"] - expected_metrics["sharpe"]) < 1e-9
    assert abs(evaluated["metrics"]["out_of_sample_sharpe"] - expected_metrics["out_of_sample_sharpe"]) < 1e-9
    assert len(evaluated["chart_series"]) == len(chart_series)
    assert candidate["summary"]
    assert candidate["analysis"]["validation_windows"]


def test_create_optimization_candidate_returns_updated_job_detail_with_full_snapshot(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-candidate-create")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    parameter_snapshot = {**strategy["parameters"], "top_n": 8}

    updated_job = create_optimization_candidate(
        client,
        job["id"],
        label="Manual candidate",
        parameter_snapshot=parameter_snapshot,
        base_parameter_version_id=base_parameter_version_id,
        metrics={"sharpe": 1.42},
        summary="Raised top_n for comparison.",
    )

    created_candidate = next(
        candidate for candidate in updated_job["candidates"] if candidate["label"] == "Manual candidate"
    )

    assert updated_job["summary"]["candidate_count"] == 5
    assert created_candidate["label"] == "Manual candidate"
    assert created_candidate["parameter_snapshot"] == parameter_snapshot
    assert created_candidate["parameter_delta"] == {"top_n": 8}
    assert created_candidate["metrics"]["sharpe"] == 1.42
    assert created_candidate["base_parameter_version_id"] == base_parameter_version_id


def test_create_optimization_candidate_snapshot_stays_stable_after_strategy_revision(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-candidate-stable")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    manual_snapshot = {**strategy["parameters"], "top_n": 6}

    updated_job = create_optimization_candidate(
        client,
        job["id"],
        label="Stable manual candidate",
        parameter_snapshot=manual_snapshot,
        base_parameter_version_id=base_parameter_version_id,
    )
    manual_candidate_id = next(
        candidate["id"]
        for candidate in updated_job["candidates"]
        if candidate["label"] == "Stable manual candidate"
    )

    revised = create_momentum_strategy(
        client,
        mode="REVISION",
        base_strategy_id=strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
        top_n=11,
        idempotency_key="materialize-candidate-stability-revision",
    )["strategy"]
    refreshed_job = assert_ok(client.get(f"/optimization-jobs/{job['id']}/detail"))
    manual_candidate = next(candidate for candidate in refreshed_job["candidates"] if candidate["id"] == manual_candidate_id)

    assert revised["current_parameter_version_id"] != base_parameter_version_id
    assert manual_candidate["parameter_snapshot"] == manual_snapshot
    assert manual_candidate["base_parameter_version_id"] == base_parameter_version_id


def test_promote_trial_set_current_keeps_base_strategy_name_when_base_matches(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-promote-success")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    updated_job = create_optimization_candidate(
        client,
        job["id"],
        label="Quarterly rebalance candidate",
        parameter_snapshot={**strategy["parameters"], "rebalance_frequency": "quarterly"},
        base_parameter_version_id=base_parameter_version_id,
    )
    candidate = next(
        candidate
        for candidate in updated_job["candidates"]
        if candidate["label"] == "Quarterly rebalance candidate"
    )

    promoted = assert_ok(
        client.post(
            f"/optimization-jobs/{job['id']}/candidates/{candidate['id']}/promote",
            json={
                "idempotency_key": "promote-success-1",
                "mode": "set_current",
                "base_parameter_version_id": base_parameter_version_id,
            },
        )
    )

    assert promoted["id"] == strategy["id"]
    assert promoted["current_parameter_version"] == 2
    assert promoted["name"] == strategy["name"]
    assert promoted["rebalance_frequency"] == "quarterly"
    assert promoted["parameters"] == candidate["parameter_snapshot"]
    assert promoted["parameter_history"][-1]["parameter_version_id"] == promoted["current_parameter_version_id"]


def test_promote_trial_records_parameter_version_metadata_contract(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-promote-metadata")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    candidate = job["candidates"][0]
    decision_note = "Promote optimization candidate after committee review."

    promoted = assert_ok(
        client.post(
            f"/optimization-jobs/{job['id']}/candidates/{candidate['id']}/promote",
            json={
                "idempotency_key": "promote-metadata-1",
                "mode": "set_current",
                "base_parameter_version_id": base_parameter_version_id,
                "comment": decision_note,
            },
        )
    )

    promoted_entry = promoted["parameter_history"][-1]
    source = promoted_entry["source"]

    assert promoted_entry["parameter_version_id"] == promoted["current_parameter_version_id"]
    assert promoted_entry["parameters"] == candidate["parameter_snapshot"]
    assert promoted_entry["comment"] == decision_note
    assert promoted_entry["decision_note"] == decision_note
    assert isinstance(promoted_entry["change_summary"], str)
    assert promoted_entry["change_summary"].strip()
    assert source["kind"] == "optimization_promotion"
    assert source["job_id"] == job["id"]
    assert source["candidate_id"] == candidate["id"]
    assert source["base_parameter_version_id"] == base_parameter_version_id
    assert isinstance(promoted_entry["alternative_versions"], list)
    assert promoted_entry["alternative_versions"]
    assert promoted_entry["rollbackable"] is False


def test_promote_trial_accepts_matching_combination_trial_id(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-promote-matching-combination")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    candidate_ids = {candidate["id"] for candidate in job["candidates"]}
    matching_trial = next(
        candidate
        for candidate in job["matching_combinations"]
        if candidate["id"] not in candidate_ids
    )

    promoted = assert_ok(
        client.post(
            f"/optimization-jobs/{job['id']}/candidates/{matching_trial['id']}/promote",
            json={
                "idempotency_key": "promote-matching-combination-1",
                "mode": "set_current",
                "base_parameter_version_id": base_parameter_version_id,
            },
        )
    )

    assert matching_trial["id"].startswith("trial_")
    assert promoted["id"] == strategy["id"]
    assert promoted["current_parameter_version_id"] != base_parameter_version_id
    assert promoted["parameters"] == matching_trial["parameter_snapshot"]
    assert promoted["parameter_history"][-1]["parameters"] == matching_trial["parameter_snapshot"]


def test_promote_trial_create_copy_syncs_top_level_rebalance_frequency(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-promote-copy-rebalance")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    updated_job = create_optimization_candidate(
        client,
        job["id"],
        label="Yearly rebalance copy",
        parameter_snapshot={**strategy["parameters"], "rebalance_frequency": "yearly"},
        base_parameter_version_id=base_parameter_version_id,
    )
    candidate = next(
        candidate
        for candidate in updated_job["candidates"]
        if candidate["label"] == "Yearly rebalance copy"
    )

    copied = assert_ok(
        client.post(
            f"/optimization-jobs/{job['id']}/candidates/{candidate['id']}/promote",
            json={
                "idempotency_key": "promote-copy-rebalance-1",
                "mode": "create_copy",
                "base_parameter_version_id": base_parameter_version_id,
            },
        )
    )

    assert copied["id"] != strategy["id"]
    assert copied["rebalance_frequency"] == "yearly"
    assert copied["parameters"]["rebalance_frequency"] == "yearly"


def test_promote_grid_candidate_refreshes_descriptive_parameter_fields(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_grid_strategy(
        client,
        idempotency_key="materialize-grid-promote-description",
        strategy_description="本金10000，围绕QQQ执行网格交易，初始仓位20%，每下跌5%买入10%，每上涨10%卖出10%。",
        benchmark_symbol="QQQ",
        initial_position=20,
        grid_interval=5,
        buy_size_pct=10,
        sell_step_pct=10,
        sell_size_pct=10,
        max_stop_loss_pct=-50,
        capital=10000,
    )
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    updated_job = create_optimization_candidate(
        client,
        job["id"],
        label="Aggressive grid candidate",
        parameter_snapshot={
            **strategy["parameters"],
            "initial_position": 80,
            "grid_interval": 8,
            "buy_size_pct": 20,
            "sell_step_pct": 20,
            "sell_size_pct": 20,
        },
        base_parameter_version_id=base_parameter_version_id,
    )
    candidate = next(
        candidate
        for candidate in updated_job["candidates"]
        if candidate["label"] == "Aggressive grid candidate"
    )

    promoted = assert_ok(
        client.post(
            f"/optimization-jobs/{job['id']}/candidates/{candidate['id']}/promote",
            json={
                "idempotency_key": "promote-grid-description-1",
                "mode": "set_current",
                "base_parameter_version_id": base_parameter_version_id,
            },
        )
    )

    expected_description = "本金10000，围绕QQQ执行网格交易，初始仓位80%，每下跌8%买入20%，每上涨20%卖出20%。"
    confirmation_values = {
        entry["key"]: entry["value"]
        for entry in promoted["confirmation_fields"]["parameters"]
    }

    assert candidate["parameter_snapshot"]["strategy_description"] == expected_description
    assert promoted["parameters"]["strategy_description"] == expected_description
    assert promoted["description"] == expected_description
    assert promoted["parameter_history"][-1]["parameters"]["strategy_description"] == expected_description
    assert confirmation_values["initial_position"] == 80
    assert confirmation_values["grid_interval"] == 8
    assert confirmation_values["buy_size_pct"] == 20
    assert confirmation_values["sell_step_pct"] == 20
    assert confirmation_values["sell_size_pct"] == 20
    assert confirmation_values["strategy_description"] == expected_description


def test_grid_optimization_generated_candidates_refresh_descriptions(tmp_path):
    client, _ = create_test_client(tmp_path)

    strategy = create_grid_strategy(
        client,
        idempotency_key="materialize-grid-generated-candidate-description",
        strategy_description="本金10000，围绕QQQ执行网格交易，初始仓位20%，每下跌5%买入10%，每上涨10%卖出10%。",
        benchmark_symbol="QQQ",
        initial_position=20,
        grid_interval=5,
        buy_size_pct=10,
        sell_step_pct=10,
        sell_size_pct=10,
        max_stop_loss_pct=-50,
        capital=10000,
    )["strategy"]

    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=strategy["current_parameter_version_id"],
        budget_combinations=1,
        search_space=[
            {"key": "initial_position", "mode": "fixed", "value": 80},
            {"key": "grid_interval", "mode": "fixed", "value": 8},
            {"key": "buy_size_pct", "mode": "fixed", "value": 20},
            {"key": "sell_step_pct", "mode": "fixed", "value": 20},
            {"key": "sell_size_pct", "mode": "fixed", "value": 20},
        ],
    )

    expected_description = "本金10000，围绕QQQ执行网格交易，初始仓位80%，每下跌8%买入20%，每上涨20%卖出20%。"

    assert job["candidates"][0]["parameter_snapshot"]["strategy_description"] == expected_description
    assert job["matching_combinations"][0]["parameter_snapshot"]["strategy_description"] == expected_description


def test_legacy_grid_run_and_strategy_detail_normalize_stale_parameter_descriptions(tmp_path):
    client, _ = create_test_client(tmp_path)
    old_description = "本金10000，围绕QQQ执行网格交易，初始仓位20%，每下跌5%买入10%，每上涨10%卖出10%。"

    strategy = create_grid_strategy(
        client,
        idempotency_key="materialize-grid-legacy-stale-description",
        strategy_description=old_description,
        benchmark_symbol="QQQ",
        initial_position=20,
        grid_interval=5,
        buy_size_pct=10,
        sell_step_pct=10,
        sell_size_pct=10,
        max_stop_loss_pct=-50,
        capital=10000,
    )["strategy"]
    stale_snapshot = {
        **strategy["parameters"],
        "initial_position": 80,
        "grid_interval": 8,
        "buy_size_pct": 20,
        "sell_step_pct": 20,
        "sell_size_pct": 20,
        "strategy_description": old_description,
    }
    service = client.app.state.service
    service.storage.execute(
        """
        UPDATE strategies
        SET parameters_json = ?,
            description = ?,
            confirmation_fields_json = ?
        WHERE id = ?
        """,
        (
            json.dumps(stale_snapshot, ensure_ascii=False),
            old_description,
            json.dumps(strategy["confirmation_fields"], ensure_ascii=False),
            strategy["id"],
        ),
    )
    service.storage.execute(
        """
        UPDATE strategy_parameter_versions
        SET parameters_json = ?
        WHERE strategy_id = ? AND parameter_version_id = ?
        """,
        (
            json.dumps(stale_snapshot, ensure_ascii=False),
            strategy["id"],
            strategy["current_parameter_version_id"],
        ),
    )

    run_id = "run_legacy_grid_stale_description"
    created_at = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    _insert_backtest_run(
        client,
        run_id=run_id,
        strategy_id=strategy["id"],
        created_at=created_at,
        is_permanent=0,
        artifact_paths=[],
    )
    service.storage.execute(
        """
        UPDATE backtest_runs
        SET parameter_snapshot_json = ?
        WHERE id = ?
        """,
        (json.dumps(stale_snapshot, ensure_ascii=False), run_id),
    )

    expected_description = "本金10000，围绕QQQ执行网格交易，初始仓位80%，每下跌8%买入20%，每上涨20%卖出20%。"

    detail = assert_ok(client.get(f"/strategies/{strategy['id']}/detail"))
    run_detail = assert_ok(client.get(f"/backtest-runs/{run_id}/detail"))
    confirmation_values = {
        entry["key"]: entry["value"]
        for entry in detail["confirmation_fields"]["parameters"]
    }

    assert detail["parameters"]["strategy_description"] == expected_description
    assert detail["description"] == expected_description
    assert detail["parameter_history"][-1]["parameters"]["strategy_description"] == expected_description
    assert confirmation_values["initial_position"] == 80
    assert confirmation_values["grid_interval"] == 8
    assert confirmation_values["buy_size_pct"] == 20
    assert confirmation_values["sell_step_pct"] == 20
    assert confirmation_values["sell_size_pct"] == 20
    assert confirmation_values["strategy_description"] == expected_description
    assert run_detail["parameter_snapshot"]["strategy_description"] == expected_description


def test_historical_backtest_run_and_strategy_views_keep_base_name_when_current_row_is_versioned(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="historical-run-version-persistence")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    candidate = job["candidates"][0]

    promoted = assert_ok(
        client.post(
            f"/optimization-jobs/{job['id']}/candidates/{candidate['id']}/promote",
            json={
                "idempotency_key": "historical-run-version-promote",
                "mode": "set_current",
                "base_parameter_version_id": base_parameter_version_id,
            },
        )
    )
    historical_version_id = promoted["current_parameter_version_id"]

    run = submit_backtest(
        client,
        strategy["id"],
        start_date="2024-01-02",
        end_date="2024-03-29",
        parameter_version_id=historical_version_id,
        idempotency_key="historical-run-version-submit",
    )

    service = client.app.state.service
    polluted_name = f"{strategy['name']}v3"
    service.storage.execute(
        "UPDATE strategies SET name = ?, current_parameter_version = ?, updated_at = ? WHERE id = ?",
        (
            polluted_name,
            3,
            "2026-04-17T09:00:00Z",
            strategy["id"],
        ),
    )

    listed_runs = assert_ok(client.get("/backtest-runs"))
    historical_run = next(item for item in listed_runs if item["id"] == run["id"])
    listed_strategies = assert_ok(client.get("/strategies"))
    listed_strategy = next(item for item in listed_strategies if item["id"] == strategy["id"])
    detail = assert_ok(client.get(f"/strategies/{strategy['id']}/detail"))

    assert polluted_name != strategy["name"]
    assert historical_run["strategy_name"] == strategy["name"]
    assert historical_run["parameter_version_id"] == historical_version_id
    assert listed_strategy["name"] == strategy["name"]
    assert detail["name"] == strategy["name"]


def test_historical_optimization_job_views_keep_base_name_and_persisted_version(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="historical-optimization-version-persistence")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    candidate = job["candidates"][0]

    promoted = assert_ok(
        client.post(
            f"/optimization-jobs/{job['id']}/candidates/{candidate['id']}/promote",
            json={
                "idempotency_key": "historical-optimization-version-promote",
                "mode": "set_current",
                "base_parameter_version_id": base_parameter_version_id,
            },
        )
    )

    service = client.app.state.service
    polluted_name = f"{strategy['name']}v3"
    service.storage.execute(
        "UPDATE strategies SET name = ?, current_parameter_version = ?, updated_at = ? WHERE id = ?",
        (
            polluted_name,
            3,
            "2026-04-17T09:10:00Z",
            strategy["id"],
        ),
    )

    listed_jobs = assert_ok(client.get("/optimization-jobs"))
    listed_job = next(item for item in listed_jobs if item["id"] == job["id"])
    detail = assert_ok(client.get(f"/optimization-jobs/{job['id']}/detail"))

    assert promoted["current_parameter_version_id"] != base_parameter_version_id
    assert polluted_name != strategy["name"]
    assert listed_job["strategy_name"] == strategy["name"]
    assert listed_job["base_parameter_version_id"] == base_parameter_version_id
    assert detail["strategy_name"] == strategy["name"]
    assert detail["base_parameter_version_id"] == base_parameter_version_id


def _insert_backtest_run(
    client,
    *,
    run_id: str,
    strategy_id: str,
    created_at: str,
    is_permanent: int,
    artifact_paths: list[str],
) -> None:
    service = client.app.state.service
    service.storage.insert_json_row(
        "backtest_runs",
        {
            "id": run_id,
            "strategy_id": strategy_id,
            "status": "COMPLETED",
            "request_kind": "official",
            "is_permanent": is_permanent,
            "start_date": "2026-03-01",
            "end_date": "2026-03-15",
            "warnings_json": "[]",
            "request_json": "{}",
            "preview_json": "{}",
            "metrics_json": "{}",
            "parameter_snapshot_json": "{}",
            "environment_summary_json": "{}",
            "relative_metrics_json": "{}",
            "consistency_score_json": "{}",
            "risk_metrics_json": "{}",
            "drawdown_events_json": "[]",
            "rolling_metrics_json": "[]",
            "monthly_returns_json": "[]",
            "chart_series_json": "[]",
            "trades_json": "[]",
            "artifact_paths_json": str(artifact_paths).replace("'", '"'),
            "trade_audit_json": "[]",
            "trades_count": 0,
            "created_at": created_at,
            "updated_at": created_at,
            "completed_at": created_at,
        },
    )


def test_purge_expired_temporary_runs_logically_deletes_only_old_temporary_runs_and_artifacts(tmp_path):
    client, db_path = create_test_client(tmp_path)
    strategy = create_momentum_strategy(client, idempotency_key="cleanup-base")["strategy"]
    service = client.app.state.service
    workspace_root = Path(db_path).parent
    old_created_at = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat(timespec="seconds").replace("+00:00", "Z")
    fresh_created_at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat(timespec="seconds").replace("+00:00", "Z")

    temp_old_run_id = "run_temp_old"
    temp_fresh_run_id = "run_temp_fresh"
    permanent_old_run_id = "run_perm_old"

    temp_old_file = workspace_root / "temp-artifacts" / "temp-old.html"
    temp_old_plot_dir = workspace_root / "web" / "dist" / "plots" / temp_old_run_id
    temp_fresh_file = workspace_root / "temp-artifacts" / "temp-fresh.html"
    permanent_old_file = workspace_root / "temp-artifacts" / "perm-old.html"

    temp_old_file.parent.mkdir(parents=True, exist_ok=True)
    temp_old_file.write_text("old", encoding="utf-8")
    temp_old_plot_dir.mkdir(parents=True, exist_ok=True)
    (temp_old_plot_dir / "plot.html").write_text("plot", encoding="utf-8")
    temp_fresh_file.write_text("fresh", encoding="utf-8")
    permanent_old_file.write_text("permanent", encoding="utf-8")

    _insert_backtest_run(
        client,
        run_id=temp_old_run_id,
        strategy_id=strategy["id"],
        created_at=old_created_at,
        is_permanent=0,
        artifact_paths=[str(temp_old_file)],
    )
    _insert_backtest_run(
        client,
        run_id=temp_fresh_run_id,
        strategy_id=strategy["id"],
        created_at=fresh_created_at,
        is_permanent=0,
        artifact_paths=[str(temp_fresh_file)],
    )
    _insert_backtest_run(
        client,
        run_id=permanent_old_run_id,
        strategy_id=strategy["id"],
        created_at=old_created_at,
        is_permanent=1,
        artifact_paths=[str(permanent_old_file)],
    )

    removed = service.purge_expired_temporary_runs()
    overview = assert_ok(client.get("/workspace/overview?include_cleanup_audit=1"))
    runs = assert_ok(client.get("/backtest-runs"))
    deleted_row = service.storage.fetch_one("SELECT * FROM backtest_runs WHERE id = ?", (temp_old_run_id,))
    deleted_detail_response = client.get(f"/backtest-runs/{temp_old_run_id}/detail")

    assert removed == 1
    assert overview["last_cleanup_count"] == 1
    assert temp_old_run_id not in [run["id"] for run in runs]
    assert temp_fresh_run_id in [run["id"] for run in runs]
    assert permanent_old_run_id in [run["id"] for run in runs]
    assert deleted_row is not None
    assert deleted_row["status"] == "DELETED"
    assert deleted_row["deleted_at"] is not None
    assert deleted_row["deleted_reason"] == "temporary_run_ttl_24h"
    assert deleted_row["artifact_paths_json"] == "[]"
    assert deleted_detail_response.status_code == 404
    assert not temp_old_file.exists()
    assert not temp_old_plot_dir.exists()
    assert temp_fresh_file.exists()
    assert permanent_old_file.exists()


def test_delete_optimization_candidate_reorders_ranks_and_returns_updated_job_detail(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-delete")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    created = create_optimization_candidate(
        client,
        job["id"],
        label="Delete me",
        parameter_snapshot={**strategy["parameters"], "top_n": 9},
        base_parameter_version_id=base_parameter_version_id,
    )
    trial_id = next(candidate["id"] for candidate in created["candidates"] if candidate["label"] == "Delete me")

    updated = assert_ok(client.delete(f"/optimization-jobs/{job['id']}/candidates/{trial_id}"))

    assert updated["summary"]["candidate_count"] == 4
    assert [candidate["rank"] for candidate in updated["candidates"]] == [1, 2, 3, 4]
    assert all(candidate["id"] != trial_id for candidate in updated["candidates"])
    assert updated["result"]["best_candidate_id"] == updated["candidates"][0]["id"]


def test_promote_trial_persists_comment_into_parameter_version_history(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-comment")
    strategy = base["strategy"]
    base_parameter_version_id = strategy["current_parameter_version_id"]
    job = create_optimization_job(
        client,
        strategy["id"],
        base_parameter_version_id=base_parameter_version_id,
    )
    candidate = job["candidates"][0]
    comment = "Adjusted stop loss for volatility"

    promoted = assert_ok(
        client.post(
            f"/optimization-jobs/{job['id']}/candidates/{candidate['id']}/promote",
            json={
                "idempotency_key": "promote-comment-1",
                "mode": "set_current",
                "base_parameter_version_id": base_parameter_version_id,
                "comment": comment,
            },
        )
    )

    service = client.app.state.service
    version_row = service.storage.fetch_one(
        "SELECT comment FROM strategy_parameter_versions WHERE strategy_id = ? AND version_number = ?",
        (strategy["id"], promoted["current_parameter_version"]),
    )

    assert promoted["parameter_history"][-1]["comment"] == comment
    assert version_row is not None
    assert version_row["comment"] == comment

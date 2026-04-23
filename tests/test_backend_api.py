from __future__ import annotations

from tests.api_test_support import (
    assert_ok,
    assert_snapshot_overview_contract,
    assert_workspace_overview_contract,
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
import os
from pathlib import Path
import json
import threading
import time
from typing import Any

from grit_backtest_platform._real_service_rebuilt import RealBacktestPlatformService
from grit_backtest_platform import _real_service_rebuilt as real_service_module
from grit_backtest_platform.market_data_repository import CoverageSummary, MarketDataRepository
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


def test_workspace_overview_contract_is_exact_on_fresh_database(tmp_path):
    client, _ = create_test_client(tmp_path)

    overview = assert_ok(client.get("/workspace/overview"))

    assert_workspace_overview_contract(overview)
    assert overview["strategy_count"] == 0
    assert overview["latest_strategy_id"] is None
    assert overview["latest_backtest_run_id"] is None
    assert overview["latest_optimization_job_id"] is None


def test_workspace_overview_can_include_cleanup_audit_without_changing_default_contract(tmp_path):
    client, _ = create_test_client(tmp_path)

    overview = assert_ok(client.get("/workspace/overview?include_cleanup_audit=1"))

    assert_workspace_overview_contract(overview, include_cleanup_audit=True)
    assert overview["last_cleanup_count"] == 0


def test_backtest_runs_list_includes_strategy_name_for_runs_index(tmp_path):
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

    assert runs[0]["id"] == "run_list_strategy_name"
    assert runs[0]["strategy_id"] == strategy["id"]
    assert runs[0]["strategy_name"] == strategy["name"]


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


def test_snapshot_overview_contract_is_exact_on_fresh_database(tmp_path):
    client, _ = create_test_client(tmp_path)

    overview = assert_ok(client.get("/data-snapshots/overview"))

    assert_snapshot_overview_contract(overview)
    assert overview["overall_status"] == "INCOMPLETE"
    assert [item["id"] for item in overview["dataset_snapshots"]] == ["ds-corporate-actions", "ds-price"]
    assert [item["id"] for item in overview["universe_snapshots"]] == ["un-sp500", "un-ndx100"]
    assert overview["latest_job"] is None
    assert overview["blocking_code"] == "SNAPSHOT_REFRESH_REQUIRED"
    assert overview["allowed_actions"] == ["refresh_snapshots"]


def test_snapshot_overview_includes_bond_fixed_income_extension(tmp_path):
    client, _ = create_test_client(tmp_path)

    overview = assert_ok(client.get("/data-snapshots/overview"))
    bond = overview["bond_fixed_income"]

    assert set(bond.keys()) == {
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
    }
    assert bond["global_pulse"]["headline"]
    assert bond["curve_preview"] == []
    assert bond["raw_registry"] == []
    assert bond["eligible_sources"] == []
    assert bond["eligible_instruments"] == []
    assert bond["selected_source_summary"]["primary_source"] == "bond_fixed_income_snapshots"
    assert bond["selected_source_summary"]["fallback_source"] is None


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

    assert decoded_job is not None
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
    assert [item["status"] for item in refreshed["dataset_snapshots"]] == ["READY", "READY"]
    assert [item["status"] for item in refreshed["universe_snapshots"]] == ["READY", "READY"]
    assert refreshed["allowed_actions"] == ["refresh_snapshots", "start_backtest"]


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


def test_repair_refresh_batches_missing_symbols_without_dropping_unattempted_gaps(tmp_path, monkeypatch):
    monkeypatch.setattr(real_service_module, "SNAPSHOT_REPAIR_SYMBOL_BATCH_SIZE", 2)
    service = RealBacktestPlatformService(tmp_path / "repair-batch.db", market_data_provider=None)
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
    assert metadata["repair_priority"] == "corporate_first_unified_queue"
    assert metadata["existing_corporate_missing_symbol_count"] == 0
    assert metadata["missing_symbols"] == ["CCC"]
    assert metadata["repair_cursor"] == 2
    assert metadata["covered_symbol_count"] == 4
    assert metadata["total_symbol_count"] == 5


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


def test_patch_optimization_job_constraints_persists_updated_filters_without_losing_existing_results(tmp_path):
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


def test_patch_optimization_job_constraints_persists_updated_filters_without_losing_existing_results(tmp_path):
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
    assert refreshed["summary"]["constraints"] == updated_constraints
    assert refreshed["result"]["constraints"] == updated_constraints
    assert refreshed["candidates"] == updated["candidates"]
    assert refreshed["request"]["objective"] == "annualized_return"
    assert refreshed["summary"]["objective"] == "annualized_return"


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

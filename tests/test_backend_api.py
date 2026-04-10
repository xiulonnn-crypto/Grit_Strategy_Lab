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

    assert runtime_provider.captured == [{"longbridge", "longbridge_static_info", "futu", "futu_rehab"}]
    assert [provider.provider_name for provider in scoped.providers] == ["yahoo", "tiingo", "akshare_us"]


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
    assert runtime_provider.scoped_calls == 0


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
    assert actions_snapshot["metadata"]["covered_symbol_count"] == 1
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
    assert metadata["missing_symbols"] == ["CCC"]
    assert metadata["repair_cursor"] == 2
    assert metadata["covered_symbol_count"] == 4
    assert metadata["total_symbol_count"] == 5


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
    assert price_snapshot["status"] == "READY"
    assert any(symbol == "AAA" and start == "1996-01-01" for symbol, start, _ in provider.calls)
    assert any(symbol == "LATEST1" and start == previous_end.isoformat() for symbol, start, _ in provider.calls)


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
    assert jobs[0]["best_candidate_id"] == second_job["result"]["best_candidate_id"]
    assert jobs[0]["best_candidate_label"] == second_job["result"]["best_candidate_label"]


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


def test_create_optimization_job_returns_running_progress_before_results_are_ready(tmp_path):
    client, _ = create_test_client(tmp_path)

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
    assert completed["summary"]["latest_update"]
    assert completed["result"]["best_candidate_id"] == completed["candidates"][0]["id"]
    assert completed["result"]["best_candidate_label"] == completed["candidates"][0]["label"]


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
            and "正在开始第 1 / 4 组评估" in running["summary"]["latest_update"]
        ):
            break
        time.sleep(0.01)

    assert running["status"] == "RUNNING"
    assert running["summary"]["completed_combinations"] == 0
    assert running["summary"]["current_stage"] == "评估组合 1/4"
    assert "正在开始第 1 / 4 组评估" in running["summary"]["latest_update"]


def test_resume_incomplete_optimization_jobs_recovers_stale_running_progress(tmp_path, monkeypatch):
    client, _ = create_test_client(tmp_path)
    service = client.app.state.service
    service.refresh_snapshots({"mode": "repair", "targets": ["price", "corporate", "universes"]})

    base = create_momentum_strategy(client, idempotency_key="materialize-optimization-recovery")
    strategy = base["strategy"]

    original_evaluate = service._evaluate_optimization_trial

    def slow_trial(
        strategy_detail: dict[str, Any],
        evaluation_request: dict[str, Any],
        payload: dict[str, Any],
        parameter_snapshot: dict[str, Any],
    ) -> dict[str, Any]:
        time.sleep(0.02)
        return original_evaluate(strategy_detail, evaluation_request, payload, parameter_snapshot)

    monkeypatch.setattr(service, "_evaluate_optimization_trial", slow_trial)
    monkeypatch.setattr(service, "_optimization_step_delay_seconds", lambda: 0.0)

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

    resumed = service.resume_incomplete_optimization_jobs()

    assert resumed == [job_id]

    deadline = time.monotonic() + 1.0
    recovering = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail"))
    while time.monotonic() < deadline:
        recovering = assert_ok(client.get(f"/optimization-jobs/{job_id}/detail"))
        if "检测到服务重启" in recovering["summary"]["latest_update"]:
            break
        time.sleep(0.01)

    assert recovering["updated_at"] != stale_updated_at
    assert recovering["status"] in {"RUNNING", "COMPLETED"}
    if recovering["status"] == "RUNNING":
        assert recovering["summary"]["completed_combinations"] == 2
        assert "检测到服务重启" in recovering["summary"]["latest_update"]

    completed = wait_for_optimization_job(client, job_id, timeout_seconds=5.0)

    assert completed["status"] == "COMPLETED"
    assert completed["summary"]["completed_combinations"] == 4
    assert completed["summary"]["progress_pct"] == 100
    assert completed["completed_at"] is not None


def test_create_optimization_job_persists_configured_request_and_result_projection(tmp_path):
    client, _ = create_test_client(tmp_path)

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
    assert created["summary"]["candidate_count"] == 4
    assert created["summary"]["completed_combinations"] == 20
    assert created["summary"]["validation_mode"] == "walk_forward"
    assert created["result"]["best_candidate_id"] == created["candidates"][0]["id"]
    assert created["result"]["best_candidate_label"] == created["candidates"][0]["label"]
    assert created["candidates"][0]["analysis"]["stability_checks"]
    assert created["candidates"][0]["analysis"]["validation_windows"]
    assert created["candidates"][0]["analysis"]["heatmap"]["cells"]
    assert len(created["candidates"][0]["analysis"]["heatmap"]["x_values"]) > 1
    assert len(created["candidates"][0]["analysis"]["heatmap"]["y_values"]) > 1


def test_create_optimization_job_candidates_use_real_backtest_metrics(tmp_path):
    client, _ = create_test_client(tmp_path)

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
    )

    service = client.app.state.service
    source_run_id = strategy.get("latest_successful_run_id")
    source_run = service.get_backtest_run_detail(source_run_id) if source_run_id else None
    strategy_detail = service.get_strategy_detail(strategy["id"])
    evaluation_request = service._build_optimization_evaluation_request(strategy_detail, source_run=source_run)
    candidate = job["candidates"][0]
    expected = service._evaluate_optimization_trial(
        strategy_detail,
        evaluation_request,
        job["request"],
        candidate["parameter_snapshot"],
    )

    assert abs(candidate["metrics"]["sharpe"] - expected["metrics"]["sharpe"]) < 1e-9
    assert abs(candidate["metrics"]["total_return"] - expected["metrics"]["total_return"]) < 1e-9
    assert abs(candidate["metrics"]["max_drawdown"] - expected["metrics"]["max_drawdown"]) < 1e-9
    assert abs(candidate["metrics"]["out_of_sample_sharpe"] - expected["metrics"]["out_of_sample_sharpe"]) < 1e-9
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

    created_candidate = updated_job["candidates"][-1]

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
    manual_candidate_id = updated_job["candidates"][-1]["id"]

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


def test_promote_trial_set_current_appends_parameter_version_when_base_matches(tmp_path):
    client, _ = create_test_client(tmp_path)

    base = create_momentum_strategy(client, idempotency_key="materialize-base-promote-success")
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
                "idempotency_key": "promote-success-1",
                "mode": "set_current",
                "base_parameter_version_id": base_parameter_version_id,
            },
        )
    )

    assert promoted["id"] == strategy["id"]
    assert promoted["current_parameter_version"] == 2
    assert promoted["parameters"] == candidate["parameter_snapshot"]
    assert promoted["parameter_history"][-1]["parameter_version_id"] == promoted["current_parameter_version_id"]


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

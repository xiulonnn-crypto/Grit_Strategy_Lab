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
)
from datetime import date, datetime, timedelta, timezone
import os
from pathlib import Path
import json
import threading
from typing import Any

from grit_backtest_platform._real_service_rebuilt import RealBacktestPlatformService
from grit_backtest_platform import _real_service_rebuilt as real_service_module
from grit_backtest_platform.market_data_repository import CoverageSummary, MarketDataRepository
from grit_backtest_platform.universe_history import (
    SP500_UNIVERSE_KEY,
    SP500_UNIVERSE_SNAPSHOT_ID,
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
    deadline = datetime.now(timezone.utc) + timedelta(seconds=1)
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
                blocker_json = '{}', metadata_json = '{}'
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
    assert price_snapshot["metadata"]["total_symbol_count"] == 1
    assert actions_snapshot["row_count"] == 1
    assert actions_snapshot["freshness_label"] == "已从现有快照恢复"
    assert actions_snapshot["metadata"]["covered_symbol_count"] == 1
    assert actions_snapshot["metadata"]["total_symbol_count"] == 1
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

    assert updated_job["summary"]["candidate_count"] == 2
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


def test_purge_expired_temporary_runs_deletes_only_old_temporary_runs_and_artifacts(tmp_path):
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

    assert removed == 1
    assert overview["last_cleanup_count"] == 1
    assert temp_old_run_id not in [run["id"] for run in runs]
    assert temp_fresh_run_id in [run["id"] for run in runs]
    assert permanent_old_run_id in [run["id"] for run in runs]
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

    assert updated["summary"]["candidate_count"] == 1
    assert [candidate["rank"] for candidate in updated["candidates"]] == [1]
    assert updated["candidates"][0]["id"] != trial_id
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

import time

from fastapi.testclient import TestClient

from grit_backtest_platform.api import create_app
from tests.api_test_support import FakeMarketDataProvider


GRID_MESSAGE = "纳指网格策略 目标QQQ，本金100000，初始买入10%，后续每跌2%买入5%，每涨5%卖出5%"


def _client(tmp_path):
    db_path = tmp_path / "grit_backtest.sqlite3"
    return TestClient(create_app(db_path, market_data_provider=FakeMarketDataProvider()))


def test_recovery_baseline_vertical_slice(tmp_path):
    client = _client(tmp_path)

    created = client.post("/strategy-creation-sessions")
    assert created.status_code == 200
    session_id = created.json()["id"]

    appended = client.post(
        f"/strategy-creation-sessions/{session_id}/messages",
        json={"content": GRID_MESSAGE},
    )
    assert appended.status_code == 200
    assert appended.json()["status"] == "NEEDS_INPUT"

    prepared = client.post(f"/strategy-creation-sessions/{session_id}/prepare-confirmation", json={})
    assert prepared.status_code == 200
    assert prepared.json()["top_level"]["strategy_type"] == "GRID"
    assert prepared.json()["top_level"]["rebalance_frequency"] == "never"

    materialized = client.post(
        f"/strategy-creation-sessions/{session_id}/materialize",
        json={"idempotency_key": "materialize-grid-1"},
    )
    assert materialized.status_code == 200
    strategy_id = materialized.json()["id"]

    refreshed = client.post("/admin/snapshot-refresh-jobs", json={})
    assert refreshed.status_code == 200
    assert refreshed.json()["overall_status"] == "READY"
    assert refreshed.json()["latest_job"]["summary"]["status"] == "READY"

    preview = client.post(
        f"/strategies/{strategy_id}/backtest-runs/preview",
        json={"start_date": "2024-03-01", "end_date": "2025-03-31"},
    )
    assert preview.status_code == 200
    preview_payload = preview.json()
    assert preview_payload["snapshot_summary"]["status"] == "READY"
    assert "blind_test_zone" in preview_payload

    submitted = client.post(
        f"/strategies/{strategy_id}/backtest-runs",
        json={"idempotency_key": "run-grid-1", "start_date": "2024-03-01", "end_date": "2025-03-31"},
    )
    assert submitted.status_code == 200
    run_id = submitted.json()["id"]

    deadline = time.time() + 5.0
    detail_payload = submitted.json()
    while time.time() < deadline:
        detail = client.get(f"/backtest-runs/{run_id}/detail")
        assert detail.status_code == 200
        detail_payload = detail.json()
        if detail_payload["status"] not in {"QUEUED", "RUNNING"}:
            break
        time.sleep(0.05)

    assert detail_payload["status"] in {"COMPLETED", "COMPLETED_WITH_WARNINGS"}
    assert detail_payload["metrics"]["cagr"] is not None
    assert detail_payload["chart_series"]
    assert detail_payload["monthly_returns"]

    trades = client.get(f"/backtest-runs/{run_id}/trades")
    assert trades.status_code == 200
    assert trades.json()["total"] >= 0

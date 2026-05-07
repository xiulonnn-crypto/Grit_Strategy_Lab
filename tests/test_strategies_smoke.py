from fastapi.testclient import TestClient

from grit_backtest_platform.api import create_app
from tests.api_test_support import assert_ok, create_grid_strategy


def test_list_strategies_returns_200(tmp_path):
    client = TestClient(create_app(tmp_path / 'grit_backtest.sqlite3'))

    response = client.get('/strategies')

    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_strategy_library_returns_strategy_and_run_lists_once(tmp_path):
    client = TestClient(create_app(tmp_path / 'grit_backtest.sqlite3'))
    created = create_grid_strategy(client, idempotency_key='strategy-library-list')["strategy"]

    payload = assert_ok(client.get('/strategy-library'))

    assert set(payload) == {"strategies", "runs"}
    assert isinstance(payload["runs"], list)
    assert created["id"] in [item["id"] for item in payload["strategies"]]


def test_archived_strategies_are_hidden_from_library_and_workspace_count(tmp_path):
    client = TestClient(create_app(tmp_path / 'grit_backtest.sqlite3'))
    created = create_grid_strategy(client, idempotency_key='archive-strategy-list')["strategy"]

    archived = assert_ok(
        client.patch(
            f"/strategies/{created['id']}",
            json={"lifecycle_status": "ARCHIVED"},
        )
    )
    strategies = assert_ok(client.get('/strategies'))
    overview = assert_ok(client.get('/workspace/overview'))

    assert archived["lifecycle_status"] == "ARCHIVED"
    assert created["id"] not in [item["id"] for item in strategies]
    assert overview["strategy_count"] == 0
    assert overview["latest_strategy_id"] is None


from fastapi.testclient import TestClient

from grit_backtest_platform.api import create_app


def test_list_strategies_returns_200(tmp_path):
    client = TestClient(create_app(tmp_path / 'grit_backtest.sqlite3'))

    response = client.get('/strategies')

    assert response.status_code == 200
    assert isinstance(response.json(), list)


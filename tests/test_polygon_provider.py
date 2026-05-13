from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import date

from grit_backtest_platform.polygon_provider import MASSIVE_BASE_URL, PolygonMarketDataProvider


class UnitPolygonProvider(PolygonMarketDataProvider):
    def __init__(self) -> None:
        super().__init__(api_key="unit-key")

    def _request_json(self, path, params):  # type: ignore[override]
        if path.startswith("/v2/aggs/"):
            return {
                "results": [
                    {
                        "t": 946684800000,
                        "o": 10.0,
                        "h": 11.0,
                        "l": 9.5,
                        "c": 10.5,
                        "v": 1000,
                    }
                ]
            }
        if path == "/v3/reference/dividends":
            return {
                "results": [
                    {
                        "ticker": params["ticker"],
                        "ex_dividend_date": "2000-01-03",
                        "cash_amount": 0.12,
                        "currency": "USD",
                    }
                ]
            }
        if path == "/v3/reference/splits":
            return {
                "results": [
                    {
                        "ticker": params["ticker"],
                        "execution_date": "2000-01-04",
                        "split_from": 1,
                        "split_to": 2,
                    }
                ]
            }
        if path.startswith("/v3/reference/tickers/"):
            return {"results": {"ticker": "ABK", "name": "Ambac Financial", "delisted_utc": "2010-01-01"}}
        raise AssertionError(path)


def test_polygon_provider_maps_prices_actions_and_identity():
    provider = UnitPolygonProvider()

    history = provider.fetch_history("abk", date(2000, 1, 1), date(2000, 1, 10))
    identity = provider.resolve_identity("abk")

    assert provider.availability().available is True
    assert history.source == "polygon"
    assert history.bars[0].date == "2000-01-01"
    assert history.bars[0].adj_close == 10.5
    assert {item["action_type"] for item in history.actions} == {"dividend", "split"}
    assert identity is not None
    assert identity["canonical_symbol"] == "ABK"
    assert identity["delisting_date"] == "2010-01-01"


def test_polygon_provider_accepts_massive_api_key_env(monkeypatch):
    monkeypatch.delenv("POLYGON_API_KEY", raising=False)
    monkeypatch.setenv("MASSIVE_API_KEY", "massive-unit-key")

    provider = PolygonMarketDataProvider()

    assert provider.api_key == "massive-unit-key"
    assert provider.base_url == MASSIVE_BASE_URL
    assert provider.availability().available is True


def test_polygon_provider_uses_massive_base_and_api_key_query(monkeypatch):
    captured = {}

    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return None

        def read(self):
            return json.dumps({"status": "OK", "results": []}).encode("utf-8")

    def fake_urlopen(request, timeout=None):
        assert isinstance(request, urllib.request.Request)
        captured["url"] = request.full_url
        captured["timeout"] = timeout
        return _Response()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    provider = PolygonMarketDataProvider(api_key="query-key", retries=1, timeout=7)
    provider._request_json("/v3/reference/dividends", {"ticker": "AAPL"})

    assert captured["url"].startswith(MASSIVE_BASE_URL + "/v3/reference/dividends?")
    assert "apiKey=query-key" in captured["url"]
    assert captured["timeout"] == 7


def test_polygon_provider_retries_with_bearer_auth_after_query_rejection(monkeypatch):
    requests = []

    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return None

        def read(self):
            return json.dumps({"status": "OK", "results": []}).encode("utf-8")

    def fake_urlopen(request, timeout=None):
        assert isinstance(request, urllib.request.Request)
        requests.append(request)
        if len(requests) == 1:
            raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", hdrs=None, fp=None)
        return _Response()

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    provider = PolygonMarketDataProvider(api_key="bearer-key", retries=1, timeout=7)
    provider._request_json("/v3/reference/dividends", {"ticker": "AAPL"})

    assert len(requests) == 2
    assert "apiKey=bearer-key" in requests[0].full_url
    assert "apiKey=" not in requests[1].full_url
    assert requests[1].get_header("Authorization") == "Bearer bearer-key"


def test_polygon_provider_classifies_403_as_entitlement(monkeypatch):
    from grit_backtest_platform.fallback_provider import ProviderExecutionSignal

    def fake_urlopen(request, timeout=None):
        body = b'{"status":"ERROR","message":"Your subscription plan does not have access to this endpoint."}'
        raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", hdrs=None, fp=FakeBody(body))

    class FakeBody:
        def __init__(self, body: bytes) -> None:
            self.body = body

        def read(self):
            return self.body

        def close(self):
            return None

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)

    provider = PolygonMarketDataProvider(api_key="limited-key", retries=1)
    try:
        provider._request_json("/v2/aggs/ticker/WYE/range/1/day/1996-01-01/2026-05-13", {})
    except ProviderExecutionSignal as exc:
        assert exc.status == "failed"
        assert exc.reason == "entitlement_required"
        assert exc.metadata["status_code"] == 403
        assert exc.metadata["auth_modes_attempted"] == ["query", "bearer"]
    else:
        raise AssertionError("Expected entitlement signal")

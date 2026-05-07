from __future__ import annotations

import json
import urllib.error
import urllib.parse
import io
from datetime import date, datetime, timezone

import pytest

from grit_backtest_platform.fallback_provider import ProviderExecutionSignal
from grit_backtest_platform.finnhub_provider import FinnhubProvider


class _FakeHttpResponse:
    def __init__(self, payload: str) -> None:
        self.payload = payload.encode("utf-8")

    def read(self) -> bytes:
        return self.payload

    def __enter__(self) -> "_FakeHttpResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def _request_url(request) -> str:
    return getattr(request, "full_url", str(request))


def test_finnhub_provider_resolves_profile_listing_and_targeted_candles(monkeypatch):
    requested_urls: list[str] = []

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        requested_urls.append(url)
        parsed = urllib.parse.urlparse(url)
        if parsed.path.endswith("/stock/profile2"):
            return _FakeHttpResponse(
                json.dumps(
                    {
                        "ticker": "TWTR",
                        "name": "Twitter Inc",
                        "exchange": "NYSE",
                        "ipo": "2013-11-07",
                        "finnhubIndustry": "Internet Content & Information",
                    }
                )
            )
        if parsed.path.endswith("/stock/symbol"):
            return _FakeHttpResponse(
                json.dumps(
                    [
                        {
                            "symbol": "TWTR",
                            "displaySymbol": "TWTR",
                            "description": "Twitter Inc",
                            "mic": "XNYS",
                        }
                    ]
                )
            )
        if parsed.path.endswith("/stock/candle"):
            return _FakeHttpResponse(
                json.dumps(
                    {
                        "s": "ok",
                        "t": [
                            int(datetime(2022, 10, 27, tzinfo=timezone.utc).timestamp()),
                            int(datetime(2022, 10, 28, tzinfo=timezone.utc).timestamp()),
                        ],
                        "o": [53.2, 53.5],
                        "h": [54.0, 54.1],
                        "l": [52.1, 52.8],
                        "c": [53.6, 53.8],
                        "v": [1234567, 7654321],
                    }
                )
            )
        raise AssertionError(f"Unexpected Finnhub request: {url}")

    monkeypatch.setattr("grit_backtest_platform.finnhub_provider.urllib.request.urlopen", fake_urlopen)
    provider = FinnhubProvider(api_key="finnhub-secret")

    identity = provider.resolve_identity("twtr")
    history = provider.fetch_history("twtr", date(2022, 10, 27), date(2022, 10, 28))

    assert provider.availability().available is True
    assert identity is not None
    assert identity["canonical_symbol"] == "TWTR"
    assert identity["listing_status"] == "active"
    assert identity["finnhub_industry"] == "Internet Content & Information"
    assert history.source == "finnhub"
    assert history.metadata["targeted_price_repair"] is True
    assert history.metadata["adj_close_proxy"] is True
    assert history.bars[1].close == 53.8
    assert all("finnhub-secret" in url for url in requested_urls)


def test_finnhub_provider_falls_back_to_legacy_profile_for_identity(monkeypatch):
    requested_paths: list[str] = []

    def fake_urlopen(request, timeout=0):
        parsed = urllib.parse.urlparse(_request_url(request))
        requested_paths.append(parsed.path)
        if parsed.path.endswith("/stock/profile2"):
            return _FakeHttpResponse(json.dumps({"error": "You don't have access to this resource."}))
        if parsed.path.endswith("/stock/profile"):
            return _FakeHttpResponse(
                json.dumps(
                    {
                        "ticker": "TWTR",
                        "name": "Twitter Inc",
                        "exchange": "NYSE",
                        "ipo": "2013-11-07",
                        "finnhubIndustry": "Internet Content & Information",
                    }
                )
            )
        if parsed.path.endswith("/stock/symbol"):
            return _FakeHttpResponse(
                json.dumps(
                    [
                        {
                            "symbol": "TWTR",
                            "displaySymbol": "TWTR",
                            "description": "Twitter Inc",
                            "mic": "XNYS",
                        }
                    ]
                )
            )
        raise AssertionError(parsed.path)

    monkeypatch.setattr("grit_backtest_platform.finnhub_provider.urllib.request.urlopen", fake_urlopen)
    provider = FinnhubProvider(api_key="finnhub-secret")

    identity = provider.resolve_identity("TWTR")

    assert identity is not None
    assert identity["canonical_symbol"] == "TWTR"
    assert identity["listing_status"] == "active"
    assert requested_paths[:2] == ["/api/v1/stock/profile2", "/api/v1/stock/profile"]


def test_finnhub_provider_retries_header_token_after_query_auth_rejection(monkeypatch):
    requested: list[tuple[str, dict[str, str]]] = []

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        headers = dict(request.header_items())
        requested.append((url, headers))
        if len(requested) == 1:
            raise urllib.error.HTTPError(
                url,
                401,
                "Unauthorized",
                {},
                io.BytesIO(b"{\"error\":\"You don't have access to this resource.\"}"),
            )
        return _FakeHttpResponse(
            json.dumps(
                {
                    "s": "ok",
                    "t": [int(datetime(2022, 10, 28, tzinfo=timezone.utc).timestamp())],
                    "o": [53.5],
                    "h": [54.1],
                    "l": [52.8],
                    "c": [53.8],
                    "v": [7654321],
                }
            )
        )

    monkeypatch.setattr("grit_backtest_platform.finnhub_provider.urllib.request.urlopen", fake_urlopen)
    provider = FinnhubProvider(api_key="finnhub-secret")

    history = provider.fetch_history("TWTR", date(2022, 10, 27), date(2022, 10, 28))

    assert history.bars[0].close == 53.8
    assert len(requested) == 2
    assert "token=finnhub-secret" in requested[0][0]
    assert "token=finnhub-secret" not in requested[1][0]
    assert requested[1][1].get("X-finnhub-token") == "finnhub-secret"


def test_finnhub_provider_returns_none_for_unmatched_identity(monkeypatch):
    def fake_urlopen(request, timeout=0):
        parsed = urllib.parse.urlparse(_request_url(request))
        if parsed.path.endswith("/stock/profile2"):
            return _FakeHttpResponse(json.dumps({}))
        if parsed.path.endswith("/stock/symbol"):
            return _FakeHttpResponse(json.dumps([]))
        raise AssertionError(parsed.path)

    monkeypatch.setattr("grit_backtest_platform.finnhub_provider.urllib.request.urlopen", fake_urlopen)
    provider = FinnhubProvider(api_key="token")

    assert provider.resolve_identity("NOPE") is None


def test_finnhub_provider_classifies_empty_candle_payload(monkeypatch):
    monkeypatch.setattr(
        "grit_backtest_platform.finnhub_provider.urllib.request.urlopen",
        lambda request, timeout=0: _FakeHttpResponse(json.dumps({"s": "no_data"})),
    )
    provider = FinnhubProvider(api_key="token")

    with pytest.raises(ProviderExecutionSignal) as exc_info:
        provider.fetch_history("AAPL", date(2022, 1, 1), date(2022, 1, 31))

    assert exc_info.value.reason == "empty_response"


def test_finnhub_provider_classifies_rate_limit_and_network_failure(monkeypatch):
    def limited(request, timeout=0):
        raise urllib.error.HTTPError(_request_url(request), 429, "Too Many Requests", {"Retry-After": "60"}, None)

    monkeypatch.setattr("grit_backtest_platform.finnhub_provider.urllib.request.urlopen", limited)
    provider = FinnhubProvider(api_key="token")

    with pytest.raises(ProviderExecutionSignal) as rate_limited:
        provider.fetch_history("AAPL", date(2022, 1, 1), date(2022, 1, 31))

    assert rate_limited.value.status == "limited"
    assert rate_limited.value.reason == "rate_limited"
    assert rate_limited.value.metadata["quota_limited"] is True

    def failed(request, timeout=0):
        raise urllib.error.URLError("dns")

    monkeypatch.setattr("grit_backtest_platform.finnhub_provider.urllib.request.urlopen", failed)

    with pytest.raises(ProviderExecutionSignal) as network:
        provider.fetch_history("AAPL", date(2022, 1, 1), date(2022, 1, 31))

    assert network.value.reason == "transient_request_failure"


def test_finnhub_provider_classifies_entitlement_after_auth_variants_fail(monkeypatch):
    attempts = 0

    def denied(request, timeout=0):
        nonlocal attempts
        attempts += 1
        raise urllib.error.HTTPError(
            _request_url(request),
            401,
            "Unauthorized",
            {},
            io.BytesIO(b"{\"error\":\"You don't have access to this resource.\"}"),
        )

    monkeypatch.setattr("grit_backtest_platform.finnhub_provider.urllib.request.urlopen", denied)
    provider = FinnhubProvider(api_key="token")

    with pytest.raises(ProviderExecutionSignal) as exc_info:
        provider.fetch_history("AAPL", date(2022, 1, 1), date(2022, 1, 31))

    assert attempts == 2
    assert exc_info.value.status == "skipped"
    assert exc_info.value.reason == "entitlement_required"
    assert exc_info.value.metadata["provider_error_fingerprint"] == "access_denied"

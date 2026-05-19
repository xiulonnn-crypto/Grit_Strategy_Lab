from __future__ import annotations

import json
import urllib.error
from datetime import date
from io import BytesIO

import pytest

from grit_backtest_platform.eodhd_provider import EodhdMarketDataProvider
from grit_backtest_platform.fallback_provider import ProviderExecutionSignal


class _FakeHttpResponse(BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def _request_url(request) -> str:
    return getattr(request, "full_url", str(request))


def test_eodhd_provider_requires_token(monkeypatch):
    monkeypatch.delenv("EODHD_API_TOKEN", raising=False)
    monkeypatch.delenv("EODHD_API_KEY", raising=False)

    provider = EodhdMarketDataProvider()

    assert provider.availability().available is False
    with pytest.raises(ProviderExecutionSignal) as exc:
        provider.fetch_history("ABGX", date(2005, 1, 1), date(2005, 1, 3))
    assert exc.value.reason == "provider_unavailable"


def test_eodhd_provider_tries_delisted_old_symbol_and_parses_actions(monkeypatch):
    monkeypatch.setenv("EODHD_API_TOKEN", "unit-token")
    requested_urls: list[str] = []

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        requested_urls.append(url)
        if "/api/eod/ABGX.US?" in url:
            return _FakeHttpResponse(json.dumps([]).encode("utf-8"))
        if "/api/eod/ABGX_old.US?" in url:
            return _FakeHttpResponse(
                json.dumps(
                    [
                        {
                            "date": "2005-01-03",
                            "open": 10.0,
                            "high": 11.0,
                            "low": 9.5,
                            "close": 10.5,
                            "adjusted_close": 10.25,
                            "volume": 12345,
                        }
                    ]
                ).encode("utf-8")
            )
        if "/api/div/ABGX_old.US?" in url:
            return _FakeHttpResponse(json.dumps([{"date": "2005-01-03", "value": 0.25}]).encode("utf-8"))
        if "/api/splits/ABGX_old.US?" in url:
            return _FakeHttpResponse(json.dumps([{"date": "2005-01-03", "split": "2/1"}]).encode("utf-8"))
        raise AssertionError(f"Unexpected URL: {url}")

    monkeypatch.setattr("grit_backtest_platform.eodhd_provider.urllib.request.urlopen", fake_urlopen)

    result = EodhdMarketDataProvider().fetch_history("ABGX", date(2005, 1, 1), date(2005, 1, 5))

    assert [item["provider_symbol"] for item in result.metadata["attempts"]] == ["ABGX.US", "ABGX_old.US"]
    assert result.metadata["provider_symbol"] == "ABGX_old.US"
    assert len(result.bars) == 1
    assert result.bars[0].adj_close == 10.25
    assert {item["action_type"] for item in result.actions} == {"dividend", "split"}
    assert any("/api/eod/ABGX_old.US?" in url for url in requested_urls)


def test_eodhd_provider_classifies_rate_limit(monkeypatch):
    monkeypatch.setenv("EODHD_API_TOKEN", "unit-token")

    def fake_urlopen(request, timeout=0):
        raise urllib.error.HTTPError(_request_url(request), 429, "Too Many Requests", hdrs=None, fp=None)

    monkeypatch.setattr("grit_backtest_platform.eodhd_provider.urllib.request.urlopen", fake_urlopen)

    with pytest.raises(ProviderExecutionSignal) as exc:
        EodhdMarketDataProvider().fetch_history("AAPL", date(2026, 1, 1), date(2026, 1, 2))

    assert exc.value.status == "limited"
    assert exc.value.reason == "rate_limited"
    assert exc.value.metadata["quota_limited"] is True


def test_eodhd_provider_classifies_free_subscription_history_limit(monkeypatch):
    monkeypatch.setenv("EODHD_API_TOKEN", "unit-token")

    def fake_urlopen(request, timeout=0):
        return _FakeHttpResponse(
            json.dumps([{"warning": "Data is limited by one year as you have free subscription"}]).encode("utf-8")
        )

    monkeypatch.setattr("grit_backtest_platform.eodhd_provider.urllib.request.urlopen", fake_urlopen)

    with pytest.raises(ProviderExecutionSignal) as exc:
        EodhdMarketDataProvider().fetch_history("KWP", date(1996, 1, 1), date(2026, 5, 19))

    assert exc.value.status == "limited"
    assert exc.value.reason == "subscription_history_limit"
    assert exc.value.metadata["entitlement_required"] is True
    assert exc.value.metadata["quota_limited"] is False

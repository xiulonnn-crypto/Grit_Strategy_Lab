from __future__ import annotations

import json
import urllib.error
import io
import uuid
from datetime import date
from pathlib import Path

import pytest

from grit_backtest_platform.fallback_provider import ProviderExecutionSignal
from grit_backtest_platform.nasdaq_wiki_provider import NasdaqWikiPriceProvider


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


def _wiki_payload(rows):
    return json.dumps(
        {
            "dataset_data": {
                "column_names": [
                    "Date",
                    "Open",
                    "High",
                    "Low",
                    "Close",
                    "Volume",
                    "Ex-Dividend",
                    "Split Ratio",
                    "Adj. Open",
                    "Adj. High",
                    "Adj. Low",
                    "Adj. Close",
                    "Adj. Volume",
                ],
                "data": rows,
            }
        }
    )


def _quotemedia_table_payload(rows):
    return json.dumps(
        {
            "datatable": {
                "columns": [
                    {"name": "ticker", "type": "String"},
                    {"name": "date", "type": "Date"},
                    {"name": "open", "type": "BigDecimal"},
                    {"name": "high", "type": "BigDecimal"},
                    {"name": "low", "type": "BigDecimal"},
                    {"name": "close", "type": "BigDecimal"},
                    {"name": "volume", "type": "Integer"},
                    {"name": "adj_open", "type": "BigDecimal"},
                    {"name": "adj_high", "type": "BigDecimal"},
                    {"name": "adj_low", "type": "BigDecimal"},
                    {"name": "adj_close", "type": "BigDecimal"},
                    {"name": "adj_volume", "type": "Integer"},
                ],
                "data": rows,
            },
            "meta": {"next_cursor_id": None},
        }
    )


def _cache_dir() -> Path:
    path = Path(".tmp") / "pytest-runtime" / "provider-unit" / f"nasdaq-wiki-{uuid.uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_nasdaq_wiki_provider_fetches_adjusted_history_and_caches(monkeypatch):
    requested_urls: list[str] = []

    def fake_urlopen(request, timeout=0):
        requested_urls.append(_request_url(request))
        return _FakeHttpResponse(
            _wiki_payload(
                [
                    ["2017-01-03", 10, 11, 9, 10.5, 1000, 0, 1, 20, 22, 18, 21, 2000],
                    ["2017-01-04", 21, 23, 20, 22.5, 2100, 0, 1, 21, 23, 20, 22.5, 2100],
                ]
            )
        )

    monkeypatch.setattr("grit_backtest_platform.nasdaq_wiki_provider.urllib.request.urlopen", fake_urlopen)
    cache_dir = _cache_dir()
    provider = NasdaqWikiPriceProvider(api_key="nasdaq-secret", cache_dir=cache_dir)

    first = provider.fetch_history("brk.b", date(2017, 1, 1), date(2017, 1, 31))
    second = provider.fetch_history("BRK.B", date(2017, 1, 1), date(2017, 1, 31))

    assert provider.availability().available is True
    assert first.source == "nasdaq_wiki"
    assert first.bars[0].open == 20.0
    assert first.bars[0].adj_close == 21.0
    assert first.metadata["provider_symbol"] == "BRK_B"
    assert first.metadata["actions_supported"] is False
    assert len(second.bars) == 2
    assert len(requested_urls) == 1
    assert "WIKI/BRK_B.json" in requested_urls[0]
    assert "api_key=nasdaq-secret" in requested_urls[0]
    assert "nasdaq-secret" not in next(cache_dir.glob("*.json")).read_text(encoding="utf-8")


def test_nasdaq_wiki_provider_retries_header_token_after_query_auth_rejection(monkeypatch):
    requested: list[tuple[str, dict[str, str]]] = []

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        headers = dict(request.header_items())
        requested.append((url, headers))
        if len(requested) == 1:
            raise urllib.error.HTTPError(
                url,
                403,
                "Forbidden",
                {},
                io.BytesIO(b'{"quandl_error":{"code":"QEPx01","message":"not authorized"}}'),
            )
        return _FakeHttpResponse(
            _wiki_payload(
                [["2017-01-03", 10, 11, 9, 10.5, 1000, 0, 1, 20, 22, 18, 21, 2000]]
            )
        )

    monkeypatch.setattr("grit_backtest_platform.nasdaq_wiki_provider.urllib.request.urlopen", fake_urlopen)
    provider = NasdaqWikiPriceProvider(api_key="nasdaq-secret", cache_dir=_cache_dir())

    history = provider.fetch_history("AAPL", date(2017, 1, 1), date(2017, 1, 31))

    assert history.bars[0].adj_close == 21.0
    assert len(requested) == 2
    assert "api_key=nasdaq-secret" in requested[0][0]
    assert "api_key=nasdaq-secret" not in requested[1][0]
    assert requested[1][1].get("X-api-token") == "nasdaq-secret"


def test_nasdaq_provider_falls_back_to_quotemedia_table_after_wiki_rejection(monkeypatch):
    requested_urls: list[str] = []

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        requested_urls.append(url)
        if "/datasets/WIKI/AAPL.json" in url:
            raise urllib.error.HTTPError(
                url,
                403,
                "Forbidden",
                {},
                io.BytesIO(b'{"quandl_error":{"code":"QEPx01","message":"not authorized"}}'),
            )
        if "/datatables/QUOTEMEDIA/PRICES.json" in url:
            return _FakeHttpResponse(
                _quotemedia_table_payload(
                    [["AAPL", "2017-01-03", 10, 11, 9, 10.5, 1000, 20, 22, 18, 21, 2000]]
                )
            )
        raise AssertionError(f"Unexpected Nasdaq Data Link request: {url}")

    monkeypatch.setattr("grit_backtest_platform.nasdaq_wiki_provider.urllib.request.urlopen", fake_urlopen)
    provider = NasdaqWikiPriceProvider(api_key="nasdaq-secret", cache_dir=_cache_dir())

    history = provider.fetch_history("AAPL", date(2017, 1, 1), date(2017, 1, 31))

    assert history.source == "nasdaq_wiki"
    assert history.bars[0].open == 20.0
    assert history.bars[0].adj_close == 21.0
    assert history.metadata["data_product"] == "QUOTEMEDIA/PRICES"
    assert any("/datasets/WIKI/AAPL.json" in url for url in requested_urls)
    table_url = next(url for url in requested_urls if "/datatables/QUOTEMEDIA/PRICES.json" in url)
    assert "ticker=AAPL" in table_url
    assert "date.gte=2017-01-01" in table_url
    assert "date.lte=2017-01-31" in table_url


def test_nasdaq_wiki_provider_classifies_empty_payload(monkeypatch):
    monkeypatch.setattr(
        "grit_backtest_platform.nasdaq_wiki_provider.urllib.request.urlopen",
        lambda request, timeout=0: _FakeHttpResponse(_wiki_payload([])),
    )
    provider = NasdaqWikiPriceProvider(api_key="token", cache_dir=_cache_dir())

    with pytest.raises(ProviderExecutionSignal) as exc_info:
        provider.fetch_history("AAPL", date(2017, 1, 1), date(2017, 1, 31))

    assert exc_info.value.reason == "empty_response"


def test_nasdaq_wiki_provider_classifies_404_and_rate_limit(monkeypatch):
    def missing_symbol(request, timeout=0):
        raise urllib.error.HTTPError(_request_url(request), 404, "Not Found", {}, None)

    monkeypatch.setattr("grit_backtest_platform.nasdaq_wiki_provider.urllib.request.urlopen", missing_symbol)
    provider = NasdaqWikiPriceProvider(api_key="token", cache_dir=_cache_dir())

    with pytest.raises(ProviderExecutionSignal) as not_found:
        provider.fetch_history("NOPE", date(2017, 1, 1), date(2017, 1, 31))

    assert not_found.value.reason == "symbol_invalid"

    def limited(request, timeout=0):
        raise urllib.error.HTTPError(_request_url(request), 429, "Too Many Requests", {"Retry-After": "60"}, None)

    monkeypatch.setattr("grit_backtest_platform.nasdaq_wiki_provider.urllib.request.urlopen", limited)

    with pytest.raises(ProviderExecutionSignal) as rate_limited:
        provider.fetch_history("AAPL", date(2017, 1, 1), date(2017, 1, 31))

    assert rate_limited.value.status == "limited"
    assert rate_limited.value.reason == "rate_limited"
    assert rate_limited.value.metadata["quota_limited"] is True


def test_nasdaq_wiki_provider_classifies_entitlement_after_auth_variants_fail(monkeypatch):
    attempts = 0

    def denied(request, timeout=0):
        nonlocal attempts
        attempts += 1
        raise urllib.error.HTTPError(
            _request_url(request),
            403,
            "Forbidden",
            {},
            io.BytesIO(b'{"quandl_error":{"code":"QEPx01","message":"not authorized"}}'),
        )

    monkeypatch.setattr("grit_backtest_platform.nasdaq_wiki_provider.urllib.request.urlopen", denied)
    provider = NasdaqWikiPriceProvider(api_key="token", cache_dir=_cache_dir())

    with pytest.raises(ProviderExecutionSignal) as exc_info:
        provider.fetch_history("AAPL", date(2017, 1, 1), date(2017, 1, 31))

    assert attempts == 4
    assert exc_info.value.reason == "entitlement_required"
    assert exc_info.value.metadata["provider_error_fingerprint"] == "QEPx01"
    assert exc_info.value.metadata["fallback_attempt_count"] == 2


def test_nasdaq_wiki_provider_classifies_network_failure(monkeypatch):
    def failed(request, timeout=0):
        raise urllib.error.URLError("dns")

    monkeypatch.setattr("grit_backtest_platform.nasdaq_wiki_provider.urllib.request.urlopen", failed)
    provider = NasdaqWikiPriceProvider(api_key="token", cache_dir=_cache_dir())

    with pytest.raises(ProviderExecutionSignal) as exc_info:
        provider.fetch_history("AAPL", date(2017, 1, 1), date(2017, 1, 31))

    assert exc_info.value.reason == "transient_request_failure"

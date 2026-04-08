from __future__ import annotations

import json
import urllib.parse
from datetime import date

from grit_backtest_platform.alpha_vantage_provider import AlphaVantageProvider
from grit_backtest_platform.api import RuntimeMarketDataProvider
from grit_backtest_platform.fallback_provider import ProviderAvailability, SequentialMarketDataProviderChain
from grit_backtest_platform.fmp_identity_provider import FmpIdentityRepairProvider
from grit_backtest_platform.sec_edgar_provider import SecEdgarProvider
from grit_backtest_platform.tiingo_provider import TiingoMarketDataProvider


class _FakeHttpResponse:
    def __init__(self, payload: str | bytes, headers: dict[str, str] | None = None) -> None:
        self.payload = payload if isinstance(payload, bytes) else payload.encode("utf-8")
        self.headers = headers or {}

    def read(self) -> bytes:
        return self.payload

    def __enter__(self) -> "_FakeHttpResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        return False


def _request_url(request) -> str:
    return getattr(request, "full_url", str(request))


def test_sequential_market_data_provider_chain_tries_providers_in_order():
    class _FailingProvider:
        provider_name = "failing"

        def availability(self) -> ProviderAvailability:
            return ProviderAvailability(provider_name=self.provider_name, available=False, reason="boom")

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            raise RuntimeError("boom")

    class _WorkingProvider:
        provider_name = "working"

        def availability(self) -> ProviderAvailability:
            return ProviderAvailability(provider_name=self.provider_name, available=True)

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            return {"symbol": symbol, "start_date": start_date, "end_date": end_date}

    chain = SequentialMarketDataProviderChain(_FailingProvider(), _WorkingProvider())

    availability = chain.availability()
    result = chain.fetch_history("AAPL", date(2026, 1, 1), date(2026, 1, 31))

    assert availability.available is True
    assert availability.metadata["selected_provider"] == "working"
    assert result["symbol"] == "AAPL"


def test_tiingo_provider_parses_daily_bars_and_actions(monkeypatch):
    monkeypatch.setenv("TIINGO_API_TOKEN", "token")
    provider = TiingoMarketDataProvider()

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        assert "api.tiingo.com/tiingo/daily/aapl/prices" in url.lower()
        return _FakeHttpResponse(
            json.dumps(
                [
                    {
                        "date": "2026-03-31T00:00:00.000Z",
                        "open": 100.0,
                        "high": 102.0,
                        "low": 99.0,
                        "close": 101.0,
                        "adjClose": 100.5,
                        "volume": 1000,
                        "divCash": 0.25,
                        "splitFactor": 1.0,
                    },
                    {
                        "date": "2026-04-01T00:00:00.000Z",
                        "open": 101.0,
                        "high": 103.0,
                        "low": 100.0,
                        "close": 102.0,
                        "adjClose": 101.5,
                        "volume": 1100,
                        "divCash": 0.0,
                        "splitFactor": 2.0,
                    },
                    {
                        "date": "2026-04-02T00:00:00.000Z",
                        "open": 102.0,
                        "high": 104.0,
                        "low": 101.0,
                        "close": 103.0,
                        "adjClose": 103.0,
                        "volume": 1200,
                        "divCash": 0.0,
                        "splitFactor": 0.5,
                    },
                ]
            )
        )

    monkeypatch.setattr("grit_backtest_platform.tiingo_provider.urllib.request.urlopen", fake_urlopen)

    result = provider.fetch_history("AAPL", date(2026, 3, 31), date(2026, 4, 2))

    assert provider.availability().available is True
    assert result.source == "tiingo"
    assert result.partial is False
    assert len(result.bars) == 3
    assert {action["action_type"] for action in result.actions} == {"dividend", "split", "reverse_split"}
    assert result.metadata["official_api"] is True
    assert result.metadata["bar_count"] == 3


def test_alpha_vantage_provider_parses_earnings_listing_status_and_rate_limit(monkeypatch):
    monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "token")
    provider = AlphaVantageProvider()

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        parsed = urllib.parse.urlparse(url)
        params = urllib.parse.parse_qs(parsed.query)
        function = params.get("function", [""])[0]
        if function == "EARNINGS":
            return _FakeHttpResponse(
                json.dumps(
                    {
                        "quarterlyEarnings": [
                            {
                                "fiscalDateEnding": "2026-03-31",
                                "reportedDate": "2026-04-24",
                                "reportedEPS": "2.31",
                                "estimatedEPS": "2.10",
                                "surprise": "0.21",
                                "surprisePercentage": "10.0",
                            }
                        ],
                        "annualEarnings": [
                            {
                                "fiscalDateEnding": "2025-12-31",
                                "reportedDate": "2026-02-01",
                                "reportedEPS": "8.40",
                                "estimatedEPS": "8.00",
                                "surprise": "0.40",
                                "surprisePercentage": "5.0",
                            }
                        ],
                    }
                )
            )
        if function == "LISTING_STATUS":
            state = params.get("state", [""])[0]
            if state == "active":
                text = (
                    "symbol,name,exchange,assetType,ipoDate,delistingDate,status\n"
                    "AAPL,Apple Inc.,NASDAQ,Stock,1980-12-12,,active\n"
                )
            elif state == "delisted":
                text = (
                    "symbol,name,exchange,assetType,ipoDate,delistingDate,status\n"
                    "TWTR,Twitter,NYSE,Stock,2013-11-07,2022-10-28,delisted\n"
                )
            else:
                text = (
                    "symbol,name,exchange,assetType,ipoDate,delistingDate,status\n"
                    "AAPL,Apple Inc.,NASDAQ,Stock,1980-12-12,,active\n"
                    "TWTR,Twitter,NYSE,Stock,2013-11-07,2022-10-28,delisted\n"
                )
            return _FakeHttpResponse(text)
        raise AssertionError(f"Unexpected Alpha Vantage request: {url}")

    monkeypatch.setattr("grit_backtest_platform.alpha_vantage_provider.urllib.request.urlopen", fake_urlopen)

    earnings = provider.fetch_earnings("AAPL")
    listing_status = provider.fetch_listing_status(state="delisted")
    identity = provider.resolve_identity("TWTR")

    assert provider.availability().available is True
    assert len(earnings) == 2
    assert earnings[0]["period"] == "quarterly"
    assert earnings[1]["period"] == "annual"
    assert listing_status[0]["symbol"] == "TWTR"
    assert identity is not None
    assert identity["symbol"] == "TWTR"
    assert identity["company_name"] == "Twitter"


def test_alpha_vantage_rate_limit_payload_raises_clear_error(monkeypatch):
    monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "token")
    provider = AlphaVantageProvider()

    def fake_urlopen(request, timeout=0):
        return _FakeHttpResponse(
            json.dumps({"Note": "Thank you for using Alpha Vantage! Our standard API call frequency is 25 requests per day."})
        )

    monkeypatch.setattr("grit_backtest_platform.alpha_vantage_provider.urllib.request.urlopen", fake_urlopen)

    try:
        provider.fetch_earnings("AAPL")
    except RuntimeError as exc:
        assert "rate limit" in str(exc).lower()
    else:
        raise AssertionError("Expected a rate-limit error from Alpha Vantage")


def test_sec_edgar_provider_resolves_identity_and_emits_report_filed(monkeypatch):
    monkeypatch.setenv("SEC_USER_AGENT", "Codex Test coder@example.com")
    provider = SecEdgarProvider()

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        if "company_tickers.json" in url:
            return _FakeHttpResponse(
                json.dumps(
                    {
                        "0": {
                            "ticker": "AAPL",
                            "title": "Apple Inc.",
                            "cik_str": 320193,
                            "exchange": "NASDAQ",
                        }
                    }
                )
            )
        if "CIK0000320193.json" in url:
            return _FakeHttpResponse(
                json.dumps(
                    {
                        "filings": {
                            "recent": {
                                "filingDate": ["2026-03-31", "2026-02-14", "2025-12-20"],
                                "form": ["10-Q", "8-K", "S-1"],
                                "accessionNumber": ["0000320193-26-000010", "0000320193-26-000009", "0000320193-25-000001"],
                                "primaryDocument": ["aapl-10q.htm", "aapl-8k.htm", "ignore.htm"],
                            }
                        }
                    }
                )
            )
        raise AssertionError(f"Unexpected SEC request: {url}")

    monkeypatch.setattr("grit_backtest_platform.sec_edgar_provider.urllib.request.urlopen", fake_urlopen)

    identity = provider.resolve_identity("AAPL")
    actions = provider.fetch_report_filings("AAPL", date(2026, 1, 1), date(2026, 4, 2))

    assert provider.availability().available is True
    assert identity is not None
    assert identity["cik"] == "0000320193"
    assert identity["company_name"] == "Apple Inc."
    assert [action["payload"]["form"] for action in actions] == ["10-Q", "8-K"]
    assert all(action["action_type"] == "report_filed" for action in actions)


def test_sec_edgar_provider_accepts_gzip_payload(monkeypatch):
    import gzip

    monkeypatch.setenv("SEC_USER_AGENT", "Codex Test coder@example.com")
    provider = SecEdgarProvider()

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        if "company_tickers.json" in url:
            payload = gzip.compress(
                json.dumps(
                    {
                        "0": {
                            "ticker": "MSFT",
                            "title": "Microsoft Corporation",
                            "cik_str": 789019,
                            "exchange": "NASDAQ",
                        }
                    }
                ).encode("utf-8")
            )
            return _FakeHttpResponse(payload, headers={"Content-Encoding": "gzip"})
        raise AssertionError(f"Unexpected SEC request: {url}")

    monkeypatch.setattr("grit_backtest_platform.sec_edgar_provider.urllib.request.urlopen", fake_urlopen)

    identity = provider.resolve_identity("MSFT")

    assert identity is not None
    assert identity["cik"] == "0000789019"


def test_fmp_identity_provider_delisted_identity_and_price_backfill(monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "token")
    provider = FmpIdentityRepairProvider()

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        parsed = urllib.parse.urlparse(url)
        if "delisted-companies" in parsed.path:
            return _FakeHttpResponse(
                json.dumps(
                    [
                        {
                            "symbol": "TWTR",
                            "companyName": "Twitter, Inc.",
                            "exchange": "NYSE",
                            "ipoDate": "2013-11-07",
                            "delistedDate": "2022-10-28",
                        }
                    ]
                )
            )
        if "historical-price-eod/full" in parsed.path:
            return _FakeHttpResponse(
                json.dumps(
                    [
                        {
                            "date": "2022-10-27",
                            "open": 53.2,
                            "high": 54.0,
                            "low": 52.1,
                            "close": 53.6,
                            "adjClose": 53.4,
                            "volume": 1234567,
                        },
                        {
                            "date": "2022-10-28",
                            "open": 53.5,
                            "high": 54.1,
                            "low": 52.8,
                            "close": 53.8,
                            "adjClose": 53.8,
                            "volume": 7654321,
                        },
                    ]
                )
            )
        raise AssertionError(f"Unexpected FMP request: {url}")

    monkeypatch.setattr("grit_backtest_platform.fmp_identity_provider.urllib.request.urlopen", fake_urlopen)

    identity = provider.resolve_identity("TWTR")
    result = provider.fetch_history("TWTR", date(2022, 10, 27), date(2022, 10, 28))

    assert provider.availability().available is True
    assert identity is not None
    assert identity["delisting_date"] == "2022-10-28"
    assert result.source == "fmp"
    assert len(result.bars) == 2
    assert result.bars[0].adj_close == 53.4
    assert result.metadata["delisted_identity_available"] is True


def test_runtime_market_data_provider_keeps_primary_actions_when_primary_price_source_succeeds():
    class _YahooProvider:
        provider_name = "yahoo"

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            return {
                "source": "yahoo",
                "bars": [
                    {"date": "2026-04-01", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "adj_close": 100.5, "volume": 1000}
                ],
                "actions": [
                    {
                        "date": "2026-04-01",
                        "action_type": "dividend",
                        "value": None,
                        "source": "yahoo",
                        "payload": {"cash": None, "from": "yahoo"},
                    }
                ],
            }

    class _TiingoProvider:
        provider_name = "tiingo"

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            return {
                "source": "tiingo",
                "bars": [
                    {"date": "2026-04-01", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "adj_close": 100.5, "volume": 1000}
                ],
                "actions": [
                    {
                        "date": "2026-04-01",
                        "action_type": "dividend",
                        "value": 0.25,
                        "source": "tiingo",
                        "payload": {"cash": 0.25, "from": "tiingo"},
                    }
                ],
            }

    provider = RuntimeMarketDataProvider([_YahooProvider(), _TiingoProvider()])

    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 1))

    assert len(result["actions"]) == 1
    assert result["actions"][0]["action_type"] == "dividend"
    assert result["actions"][0]["value"] is None
    assert result["actions"][0]["payload"]["from"] == "yahoo"
    assert result["actions"][0]["payload"]["cash"] is None


def test_runtime_market_data_provider_stops_after_first_price_provider_success():
    calls: list[str] = []

    class _YahooProvider:
        provider_name = "yahoo"

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            calls.append("yahoo")
            return {
                "source": "yahoo",
                "bars": [
                    {"date": "2026-04-01", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "adj_close": 100.5, "volume": 1000}
                ],
                "actions": [],
                "warnings": [],
                "partial": False,
                "metadata": {},
            }

    class _TiingoProvider:
        provider_name = "tiingo"

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            calls.append("tiingo")
            raise AssertionError("secondary price provider should not be called after yahoo succeeds")

    provider = RuntimeMarketDataProvider([_YahooProvider(), _TiingoProvider()])

    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 1))

    assert calls == ["yahoo"]
    assert result["source"] == "yahoo"
    assert len(result["bars"]) == 1

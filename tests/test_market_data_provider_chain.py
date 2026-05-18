from __future__ import annotations

import io
import json
import sys
import urllib.error
import urllib.parse
from types import SimpleNamespace
from datetime import date

import pytest

import grit_backtest_platform.api as api_module
from grit_backtest_platform.alpha_vantage_provider import AlphaVantageProvider
from grit_backtest_platform.api import RuntimeMarketDataProvider
from grit_backtest_platform.akshare_us_provider import AkshareUsPriceProvider
from grit_backtest_platform._bond_fixed_income_provider import _lqd_snapshot
from grit_backtest_platform.fallback_provider import (
    ProviderAvailability,
    ProviderExecutionSignal,
    SequentialMarketDataProviderChain,
)
from grit_backtest_platform.fmp_identity_provider import FmpIdentityRepairProvider
from grit_backtest_platform.longbridge_provider import LongbridgeQuoteProvider, LongbridgeStaticInfoProvider
from grit_backtest_platform.openbb_provider import (
    OpenBBBondFixedIncomeProvider,
    OpenBBCurrentUniverseConstituentCheckProvider,
    OpenBBTiingoMarketDataProvider,
    OpenBBYfinanceMarketDataProvider,
)
from grit_backtest_platform.sec_edgar_provider import SecEdgarProvider
from grit_backtest_platform.tiingo_provider import TiingoMarketDataProvider
from grit_backtest_platform.tiingo_symbology_provider import TiingoSymbologyProvider
from grit_backtest_platform.yfinance_provider import YfinanceMarketDataProvider

api_module.default_universe_history_providers = lambda: []


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


def test_yfinance_provider_parses_daily_bars_and_actions(monkeypatch):
    provider = YfinanceMarketDataProvider()

    class _FakeHistoryFrame:
        def __init__(self, rows):
            self._rows = rows
            self.empty = False

        def reset_index(self):
            return self

        def to_dict(self, orient):
            assert orient == "records"
            return list(self._rows)

    class _FakeTicker:
        def __init__(self, symbol: str) -> None:
            self.symbol = symbol

        def history(self, **kwargs):
            assert kwargs["auto_adjust"] is False
            assert kwargs["actions"] is True
            return _FakeHistoryFrame(
                [
                    {
                        "Date": "2026-04-01 00:00:00",
                        "Open": 100.0,
                        "High": 101.0,
                        "Low": 99.0,
                        "Close": 100.5,
                        "Adj Close": 100.25,
                        "Volume": 1000,
                        "Dividends": 0.25,
                        "Stock Splits": 0.0,
                    },
                    {
                        "Date": "2026-04-02 00:00:00",
                        "Open": 100.5,
                        "High": 102.0,
                        "Low": 100.0,
                        "Close": 101.5,
                        "Adj Close": 101.5,
                        "Volume": 1200,
                        "Dividends": 0.0,
                        "Stock Splits": 2.0,
                    },
                ]
            )

    monkeypatch.setattr(
        "grit_backtest_platform.yfinance_provider._load_yfinance",
        lambda: SimpleNamespace(Ticker=_FakeTicker),
    )

    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))

    assert provider.availability().available is True
    assert result.source == "yfinance"
    assert len(result.bars) == 2
    assert {item["action_type"] for item in result.actions} == {"dividend", "split"}
    assert result.bars[0].adj_close == 100.25


def test_openbb_yfinance_provider_lazily_maps_credentials_and_history(monkeypatch):
    class _Credentials:
        pass

    captured: dict[str, object] = {}
    credentials = _Credentials()

    def historical(**kwargs):
        captured.update(kwargs)
        return SimpleNamespace(
            results=[
                {
                    "date": "2026-04-01",
                    "open": 100.0,
                    "high": 102.0,
                    "low": 99.0,
                    "close": 101.0,
                    "adjusted_close": 100.5,
                    "volume": 1200,
                    "dividends": 0.25,
                    "stock_splits": 2.0,
                }
            ]
        )

    fake_obb = SimpleNamespace(
        user=SimpleNamespace(credentials=credentials),
        equity=SimpleNamespace(price=SimpleNamespace(historical=historical)),
    )
    monkeypatch.setenv("TIINGO_API_TOKEN", "tiingo-token")
    monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "alpha-token")
    monkeypatch.setenv("FMP_API_KEY", "fmp-token")
    monkeypatch.setenv("FRED_API_KEY", "fred-token")
    monkeypatch.setattr("grit_backtest_platform.openbb_provider._load_obb", lambda: fake_obb)

    provider = OpenBBYfinanceMarketDataProvider()
    payload = provider.fetch_history("aapl", date(2026, 4, 1), date(2026, 4, 2))

    assert captured["provider"] == "yfinance"
    assert captured["symbol"] == "AAPL"
    assert getattr(credentials, "tiingo_token") == "tiingo-token"
    assert getattr(credentials, "alpha_vantage_api_key") == "alpha-token"
    assert getattr(credentials, "fmp_api_key") == "fmp-token"
    assert getattr(credentials, "fred_api_key") == "fred-token"
    assert payload.source == "openbb_yfinance"
    assert payload.bars[0].date == "2026-04-01"
    assert [action["action_type"] for action in payload.actions] == ["dividend", "split"]


def test_openbb_provider_reports_missing_package_and_key_without_import_side_effect(monkeypatch):
    monkeypatch.delenv("TIINGO_API_TOKEN", raising=False)
    monkeypatch.setattr(
        "grit_backtest_platform.openbb_provider._load_obb",
        lambda: (_ for _ in ()).throw(ImportError("No module named openbb")),
    )

    package_report = OpenBBYfinanceMarketDataProvider().availability()
    key_report = OpenBBTiingoMarketDataProvider().availability()

    assert package_report.available is False
    assert package_report.metadata["requires_extra"] == "openbb-provider"
    assert key_report.available is False
    assert "TIINGO_API_TOKEN" in str(key_report.reason)


def test_openbb_provider_classifies_rate_limit_and_malformed_payload(monkeypatch):
    def limited_history(**kwargs):
        raise RuntimeError("429 Too Many Requests")

    fake_limited = SimpleNamespace(
        user=SimpleNamespace(credentials=SimpleNamespace()),
        equity=SimpleNamespace(price=SimpleNamespace(historical=limited_history)),
    )
    monkeypatch.setattr("grit_backtest_platform.openbb_provider._load_obb", lambda: fake_limited)

    with pytest.raises(ProviderExecutionSignal) as limited:
        OpenBBYfinanceMarketDataProvider().fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))

    assert limited.value.status == "limited"
    assert limited.value.reason == "rate_limited"
    assert limited.value.metadata["quota_limited"] is True

    fake_empty = SimpleNamespace(
        user=SimpleNamespace(credentials=SimpleNamespace()),
        equity=SimpleNamespace(price=SimpleNamespace(historical=lambda **kwargs: SimpleNamespace(results=[]))),
    )
    monkeypatch.setattr("grit_backtest_platform.openbb_provider._load_obb", lambda: fake_empty)

    with pytest.raises(ProviderExecutionSignal) as empty:
        OpenBBYfinanceMarketDataProvider().fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))

    assert empty.value.reason == "no_history"


def test_yfinance_provider_classifies_rate_limit(monkeypatch):
    provider = YfinanceMarketDataProvider()

    class _FakeTicker:
        def __init__(self, symbol: str) -> None:
            self.symbol = symbol

        def history(self, **kwargs):
            raise RuntimeError("429 Too Many Requests")

    monkeypatch.setattr(
        "grit_backtest_platform.yfinance_provider._load_yfinance",
        lambda: SimpleNamespace(Ticker=_FakeTicker),
    )

    with pytest.raises(ProviderExecutionSignal) as exc:
        provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))

    assert exc.value.status == "limited"
    assert exc.value.reason == "rate_limited_or_blocked"


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
        if function == "EARNINGS_ESTIMATES":
            return _FakeHttpResponse(
                json.dumps(
                    {
                        "quarterlyEarningsEstimates": [
                            {
                                "fiscalDateEnding": "2026-06-30",
                                "reportDate": "2026-07-25",
                                "estimatedEPSAvg": "2.50",
                                "estimatedEPSHigh": "2.70",
                                "estimatedEPSLow": "2.30",
                                "estimatedEPSAnalystCount": "24",
                                "estimatedRevenueAvg": "100000000000",
                                "estimatedRevenueHigh": "105000000000",
                                "estimatedRevenueLow": "95000000000",
                                "estimatedRevenueAnalystCount": "21",
                                "epsRevisionUp": "8",
                                "epsRevisionDown": "2",
                            }
                        ]
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
    estimates = provider.fetch_earnings_estimates("AAPL")
    listing_status = provider.fetch_listing_status(state="delisted")
    identity = provider.resolve_identity("TWTR")

    assert provider.availability().available is True
    assert len(earnings) == 2
    assert len(estimates) == 1
    assert estimates[0]["period"] == "quarterly"
    assert estimates[0]["eps_estimate_average"] == 2.5
    assert estimates[0]["revenue_analyst_count"] == 21.0
    assert earnings[0]["period"] == "quarterly"
    assert earnings[1]["period"] == "annual"
    assert listing_status[0]["symbol"] == "TWTR"
    assert identity is not None
    assert identity["symbol"] == "TWTR"
    assert identity["company_name"] == "Twitter"


def test_alpha_vantage_provider_parses_daily_adjusted_bars(monkeypatch):
    monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "token")
    provider = AlphaVantageProvider()

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        parsed = urllib.parse.urlparse(url)
        params = urllib.parse.parse_qs(parsed.query)
        function = params.get("function", [""])[0]
        assert function == "TIME_SERIES_DAILY_ADJUSTED"
        return _FakeHttpResponse(
            json.dumps(
                {
                    "Time Series (Daily)": {
                        "2026-04-02": {
                            "1. open": "101.0",
                            "2. high": "102.0",
                            "3. low": "100.0",
                            "4. close": "101.5",
                            "5. adjusted close": "101.25",
                            "6. volume": "1200",
                        },
                        "2026-04-01": {
                            "1. open": "100.0",
                            "2. high": "101.0",
                            "3. low": "99.0",
                            "4. close": "100.5",
                            "5. adjusted close": "100.25",
                            "6. volume": "1000",
                        },
                    }
                }
            )
        )

    monkeypatch.setattr("grit_backtest_platform.alpha_vantage_provider.urllib.request.urlopen", fake_urlopen)

    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))

    assert result.source == "alpha_vantage"
    assert len(result.bars) == 2
    assert result.bars[0].date == "2026-04-01"
    assert result.bars[0].adj_close == 100.25
    assert result.metadata["targeted_price_repair"] is True


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
    monkeypatch.setenv("SEC_USER_AGENT", "Codex Test/1.0")
    monkeypatch.setenv("SEC_CONTACT_EMAIL", "coder@example.com")
    provider = SecEdgarProvider()

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        assert request.headers["User-agent"] == "Codex Test/1.0 (coder@example.com)"
        assert request.headers["From"] == "coder@example.com"
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


def test_sec_edgar_provider_resolves_legacy_ticker_alias(monkeypatch):
    provider = SecEdgarProvider(user_agent="Test test@example.com")
    monkeypatch.setattr(provider, "_load_ticker_index", lambda: {})

    identity = provider.resolve_identity("YHOO")

    assert identity is not None
    assert identity["cik"] == "0001011006"
    assert identity["company_name"] == "Yahoo Inc"
    assert identity["source"] == "sec_edgar_legacy_alias"
    cce_identity = provider.resolve_identity("CCE")
    assert cce_identity is not None
    assert cce_identity["cik"] == "0001491675"


def test_sec_edgar_provider_accepts_gzip_payload(monkeypatch):
    import gzip

    monkeypatch.setenv("SEC_USER_AGENT", "Codex Test/1.0")
    monkeypatch.setenv("SEC_CONTACT_EMAIL", "coder@example.com")
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


def test_sec_edgar_provider_parses_companyfacts_fundamental_points(monkeypatch):
    monkeypatch.setenv("SEC_USER_AGENT", "Codex Test/1.0")
    monkeypatch.setenv("SEC_CONTACT_EMAIL", "coder@example.com")
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
        if "companyfacts/CIK0000320193.json" in url:
            fact_row = {
                "end": "2026-03-31",
                "filed": "2026-05-01",
                "fy": 2026,
                "fp": "Q1",
                "form": "10-Q",
                "accn": "0000320193-26-000010",
            }
            return _FakeHttpResponse(
                json.dumps(
                    {
                        "cik": 320193,
                        "facts": {
                            "us-gaap": {
                                "RevenueFromContractWithCustomerExcludingAssessedTax": {
                                    "units": {"USD": [{**fact_row, "val": 100.0}]}
                                },
                                "NetIncomeLoss": {"units": {"USD": [{**fact_row, "val": 12.0}]}},
                                "Assets": {"units": {"USD": [{**fact_row, "val": 120.0}]}},
                                "Liabilities": {"units": {"USD": [{**fact_row, "val": 60.0}]}},
                                "LiabilitiesCurrent": {"units": {"USD": [{**fact_row, "val": 20.0}]}},
                                "StockholdersEquity": {"units": {"USD": [{**fact_row, "val": 60.0}]}},
                            }
                        },
                    }
                )
            )
        raise AssertionError(f"Unexpected SEC request: {url}")

    monkeypatch.setattr("grit_backtest_platform.sec_edgar_provider.urllib.request.urlopen", fake_urlopen)

    points = provider.fetch_fundamental_points("AAPL", start_date=date(2026, 1, 1), end_date=date(2026, 12, 31))

    assert len(points) == 1
    point = points[0]
    assert point["source"] == "sec_edgar"
    assert point["publish_date"] == "2026-05-01"
    assert point["available_at"] == "2026-05-01"
    assert point["revenue"] == 100.0
    assert point["net_income"] == 12.0
    assert point["total_assets"] == 120.0
    assert point["total_liabilities"] == 60.0
    assert point["metadata"]["fact_tags"] == [
        "Assets",
        "Liabilities",
        "LiabilitiesCurrent",
        "NetIncomeLoss",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "StockholdersEquity",
    ]


def test_sec_edgar_provider_parses_ifrs_companyfacts_fundamental_points():
    provider = SecEdgarProvider(user_agent="Test test@example.com")
    fact_row = {
        "end": "2025-12-31",
        "filed": "2026-03-13",
        "fy": 2025,
        "fp": "FY",
        "form": "20-F",
        "accn": "0001650107-26-000029",
    }
    payload = {
        "cik": 1650107,
        "facts": {
            "ifrs-full": {
                "Revenue": {"units": {"EUR": [{**fact_row, "val": 100.0}]}},
                "GrossProfit": {"units": {"EUR": [{**fact_row, "val": 35.0}]}},
                "ProfitLoss": {"units": {"EUR": [{**fact_row, "val": 12.0}]}},
                "Assets": {"units": {"EUR": [{**fact_row, "val": 250.0}]}},
                "Liabilities": {"units": {"EUR": [{**fact_row, "val": 160.0}]}},
                "Equity": {"units": {"EUR": [{**fact_row, "val": 90.0}]}},
                "CurrentLiabilities": {"units": {"EUR": [{**fact_row, "val": 40.0}]}},
                "Borrowings": {"units": {"EUR": [{**fact_row, "val": 70.0}]}},
                "CashAndCashEquivalents": {"units": {"EUR": [{**fact_row, "val": 18.0}]}},
                "NumberOfSharesOutstanding": {"units": {"shares": [{**fact_row, "val": 4.0}]}},
            }
        },
    }

    points = provider._fundamental_points_from_payload(
        "CCEP",
        payload,
        start_date=date(2025, 1, 1),
        end_date=date(2026, 12, 31),
    )

    assert len(points) == 1
    point = points[0]
    assert point["publish_date"] == "2026-03-13"
    assert point["revenue"] == 100.0
    assert point["gross_profit"] == 35.0
    assert point["net_income"] == 12.0
    assert point["total_assets"] == 250.0
    assert point["total_liabilities"] == 160.0
    assert point["book_value_equity"] == 90.0
    assert point["total_debt"] == 70.0
    assert point["shares_outstanding"] == 4.0
    assert point["metadata"]["fact_taxonomies"] == ["ifrs-full"]


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
        supports_action_enrichment = True

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
    assert all(item["provider"] != "tiingo" or item["status"] == "skipped" for item in result["metadata"]["provider_results"])


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
        supports_action_enrichment = True

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            calls.append("tiingo")
            return {
                "source": "tiingo",
                "bars": [
                    {"date": "2026-04-01", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "adj_close": 100.5, "volume": 1000}
                ],
                "actions": [
                    {"date": "2026-04-01", "action_type": "dividend", "value": 0.25, "source": "tiingo"}
                ],
                "warnings": [],
                "partial": False,
                "metadata": {},
            }

    class _AkshareProvider:
        provider_name = "akshare_us"

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            calls.append("akshare_us")
            raise AssertionError("non-action enrichment provider should not be called after yahoo succeeds")

    provider = RuntimeMarketDataProvider(
        [_YahooProvider(), _TiingoProvider(), _AkshareProvider()],
        missing_providers=["sec_edgar"],
    )

    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 1))

    assert calls == ["yahoo"]
    assert result["source"] == "yahoo"
    assert len(result["bars"]) == 1
    assert len(result["actions"]) == 0
    provider_results = result["metadata"]["provider_results"]
    assert [
        (item["provider"], item["status"])
        for item in provider_results
    ] == [
        ("yahoo", "succeeded"),
        ("tiingo", "skipped"),
        ("akshare_us", "skipped"),
        ("sec_edgar", "unavailable"),
    ]
    assert provider_results[0]["selection_status"] == "selected_primary"
    assert provider_results[1]["reason"] == "primary_price_source_already_selected"
    assert provider_results[2]["reason"] == "primary_price_source_already_selected"
    assert provider_results[3]["kind"] == "filings_availability"


def test_runtime_market_data_provider_no_price_bars_keeps_event_provider_failures_out_of_price_message():
    class _YahooProvider:
        provider_name = "yahoo"

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            raise RuntimeError("yahoo unavailable")

    class _AlphaProvider:
        provider_name = "alpha_vantage"

        def fetch_earnings(self, symbol: str):
            raise RuntimeError("alpha limited")

    class _SecProvider:
        provider_name = "sec_edgar"

        def fetch_report_filings(self, symbol: str, start_date: date, end_date: date):
            raise RuntimeError("sec unavailable")

    provider = RuntimeMarketDataProvider([_YahooProvider(), _AlphaProvider(), _SecProvider()])

    with pytest.raises(api_module.RuntimeMarketDataFetchError) as exc_info:
        provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))

    exc = exc_info.value
    assert "yahoo unavailable" in str(exc)
    assert "alpha limited" not in str(exc)
    assert "sec unavailable" not in str(exc)
    assert exc.metadata["history_warnings"] == ["yahoo: yahoo unavailable"]
    assert "alpha_vantage: alpha limited" in exc.metadata["enrichment_warnings"]
    assert "sec_edgar: sec unavailable" in exc.metadata["enrichment_warnings"]


def test_runtime_market_data_provider_builder_orders_price_and_identity_sources(monkeypatch):
    monkeypatch.delenv("GRIT_ENABLE_OPENBB_PROVIDER", raising=False)

    class _YahooProvider:
        provider_name = "yahoo"

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            return {
                "source": "yahoo",
                "bars": [
                    {"date": "2026-04-01", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "adj_close": 100.5, "volume": 1000}
                ],
                "actions": [],
            }

    providers = {
        ("yfinance_provider", ("YfinanceMarketDataProvider",)): SimpleNamespace(
            provider_name="yfinance",
            fetch_history=lambda *args, **kwargs: None,
            supports_action_enrichment=True,
        ),
        ("tiingo_provider", ("TiingoMarketDataProvider", "TiingoProvider")): SimpleNamespace(
            provider_name="tiingo", fetch_history=lambda *args, **kwargs: None
        ),
        ("tiingo_symbology_provider", ("TiingoSymbologyProvider",)): SimpleNamespace(
            provider_name="tiingo_symbology", resolve_identity=lambda symbol: {"symbol": symbol, "source": "tiingo_symbology"}
        ),
        ("longbridge_provider", ("LongbridgeStaticInfoProvider",)): SimpleNamespace(
            provider_name="longbridge_static_info",
            resolve_identity=lambda symbol: {"symbol": symbol, "source": "longbridge_static_info"},
        ),
        ("longbridge_provider", ("LongbridgeQuoteProvider",)): SimpleNamespace(
            provider_name="longbridge", fetch_history=lambda *args, **kwargs: None
        ),
        ("akshare_us_provider", ("AkshareUsPriceProvider", "AkShareUsPriceProvider")): SimpleNamespace(
            provider_name="akshare_us", fetch_history=lambda *args, **kwargs: None
        ),
        ("fmp_identity_provider", ("FmpIdentityRepairProvider", "FmpMarketDataProvider", "FmpPriceRepairProvider")): SimpleNamespace(
            provider_name="fmp",
            fetch_history=lambda *args, **kwargs: None,
            resolve_identity=lambda symbol: {"symbol": symbol, "source": "fmp"},
        ),
        ("nasdaq_wiki_provider", ("NasdaqWikiPriceProvider",)): SimpleNamespace(
            provider_name="nasdaq_wiki", fetch_history=lambda *args, **kwargs: None
        ),
        ("stooq_provider", ("StooqZipPriceProvider", "StooqPriceProvider")): SimpleNamespace(
            provider_name="stooq", fetch_history=lambda *args, **kwargs: None
        ),
        ("finnhub_provider", ("FinnhubProvider",)): SimpleNamespace(
            provider_name="finnhub",
            fetch_history=lambda *args, **kwargs: None,
            resolve_identity=lambda symbol: {"symbol": symbol, "source": "finnhub"},
            supports_targeted_price_repair=True,
        ),
        ("alpha_vantage_provider", ("AlphaVantageProvider", "AlphaVantageEventProvider", "AlphaVantageMarketDataProvider")): SimpleNamespace(
            provider_name="alpha_vantage",
            fetch_earnings=lambda symbol: [],
            resolve_identity=lambda symbol: {"symbol": symbol, "source": "alpha_vantage"},
        ),
        ("sec_edgar_provider", ("SecEdgarEventProvider", "SecEdgarProvider")): SimpleNamespace(
            provider_name="sec_edgar", fetch_report_filings=lambda symbol, start_date, end_date: []
        ),
    }

    monkeypatch.setattr(api_module, "YahooMarketDataProvider", _YahooProvider)
    monkeypatch.setattr(
        api_module,
        "_load_provider",
        lambda module_name, class_names: (providers.get((module_name, class_names)), None),
    )

    runtime = api_module.build_runtime_market_data_provider()

    assert [getattr(provider, "provider_name", "") for provider in runtime.providers] == [
        "yahoo",
        "yfinance",
        "tiingo",
        "tiingo_symbology",
        "longbridge_static_info",
        "longbridge",
        "akshare_us",
        "fmp",
        "nasdaq_wiki",
        "stooq",
        "finnhub",
        "alpha_vantage",
        "sec_edgar",
    ]
    assert [provider.provider_name for provider in runtime.price_providers] == [
        "yahoo",
        "yfinance",
        "tiingo",
        "longbridge",
        "akshare_us",
        "fmp",
        "nasdaq_wiki",
        "stooq",
    ]
    assert [provider.provider_name for provider in runtime.identity_providers] == [
        "tiingo_symbology",
        "longbridge_static_info",
        "fmp",
        "finnhub",
        "alpha_vantage",
    ]
    assert [provider.provider_name for provider in runtime.targeted_price_repair_providers] == ["finnhub"]
    assert runtime.fallback_provider.provider_name == "yfinance"


def test_runtime_market_data_provider_builder_registers_openbb_only_when_enabled(monkeypatch):
    class _YahooProvider:
        provider_name = "yahoo"

    def fake_load_provider(module_name, class_names):
        if module_name == "openbb_provider":
            return (
                SimpleNamespace(
                    provider_name={
                        ("OpenBBYfinanceMarketDataProvider",): "openbb_yfinance",
                        ("OpenBBTiingoMarketDataProvider",): "openbb_tiingo",
                        ("OpenBBFmpMarketDataProvider",): "openbb_fmp",
                        ("OpenBBAlphaVantagePriceRepairProvider",): "openbb_alpha_vantage",
                    }[class_names],
                    fetch_history=lambda *args, **kwargs: None,
                    supports_targeted_price_repair=class_names == ("OpenBBAlphaVantagePriceRepairProvider",),
                    supports_action_enrichment=class_names != ("OpenBBAlphaVantagePriceRepairProvider",),
                ),
                None,
            )
        return None, "missing"

    monkeypatch.setattr(api_module, "YahooMarketDataProvider", _YahooProvider)
    monkeypatch.setattr(api_module, "_load_provider", fake_load_provider)

    monkeypatch.delenv("GRIT_ENABLE_OPENBB_PROVIDER", raising=False)
    disabled = api_module.build_runtime_market_data_provider()
    assert all(not provider.provider_name.startswith("openbb_") for provider in disabled.providers)

    monkeypatch.setenv("GRIT_ENABLE_OPENBB_PROVIDER", "1")
    enabled = api_module.build_runtime_market_data_provider()

    assert [provider.provider_name for provider in enabled.providers if provider.provider_name.startswith("openbb_")] == [
        "openbb_yfinance",
        "openbb_tiingo",
        "openbb_fmp",
        "openbb_alpha_vantage",
    ]
    assert [provider.provider_name for provider in enabled.price_providers if provider.provider_name.startswith("openbb_")] == [
        "openbb_yfinance",
        "openbb_tiingo",
        "openbb_fmp",
    ]
    assert [provider.provider_name for provider in enabled.targeted_price_repair_providers] == [
        "openbb_alpha_vantage"
    ]
    assert hasattr(enabled, "bond_fixed_income_provider")
    assert hasattr(enabled, "current_universe_constituent_checker")


def test_runtime_market_data_provider_marks_yfinance_as_succeeded_not_selected():
    class _YahooProvider:
        provider_name = "yahoo"

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            return {
                "source": "yahoo",
                "bars": [
                    {"date": "2026-04-01", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "adj_close": 100.5, "volume": 1000}
                ],
                "actions": [],
            }

    class _YfinanceProvider:
        provider_name = "yfinance"
        supports_action_enrichment = True

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            return {
                "source": "yfinance",
                "bars": [
                    {"date": "2026-04-01", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "adj_close": 100.5, "volume": 1000}
                ],
                "actions": [
                    {"date": "2026-04-01", "action_type": "dividend", "value": 0.25, "source": "yfinance"}
                ],
            }

    provider = RuntimeMarketDataProvider([_YahooProvider(), _YfinanceProvider()])

    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 1))

    provider_results = result["metadata"]["provider_results"]
    assert [(item["provider"], item["status"]) for item in provider_results[:2]] == [
        ("yahoo", "succeeded"),
        ("yfinance", "skipped"),
    ]
    assert provider_results[0]["selection_status"] == "selected_primary"
    assert provider_results[1]["reason"] == "primary_price_source_already_selected"
    assert result["actions"] == []


def test_runtime_market_data_provider_uses_alpha_only_for_targeted_price_repair():
    class _FailingProvider:
        def __init__(self, provider_name: str) -> None:
            self.provider_name = provider_name

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            raise RuntimeError(f"{self.provider_name} unavailable")

    class _AlphaTargetedProvider:
        provider_name = "alpha_vantage"
        supports_targeted_price_repair = True

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            return {
                "source": "alpha_vantage",
                "bars": [
                    {"date": "2026-04-01", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "adj_close": 100.25, "volume": 1000}
                ],
                "actions": [],
            }

        def fetch_earnings(self, symbol: str):
            return []

    providers = [
        _FailingProvider("yahoo"),
        _FailingProvider("yfinance"),
        _FailingProvider("tiingo"),
        _FailingProvider("longbridge"),
        _FailingProvider("akshare_us"),
        _FailingProvider("fmp"),
        _AlphaTargetedProvider(),
    ]

    provider = RuntimeMarketDataProvider(providers, allow_targeted_price_repair=True)
    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 1))

    assert result["source"] == "alpha_vantage"
    alpha_result = next(
        item for item in result["metadata"]["provider_results"] if item["provider"] == "alpha_vantage" and item["kind"] == "targeted_price_repair"
    )
    assert alpha_result["selection_status"] == "selected_primary"
    assert alpha_result["reason"] == "targeted_price_repair"


def test_runtime_market_data_provider_uses_openbb_alpha_only_for_targeted_price_repair():
    class _FailingProvider:
        def __init__(self, provider_name: str) -> None:
            self.provider_name = provider_name

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            raise RuntimeError(f"{self.provider_name} unavailable")

    class _OpenBBAlphaTargetedProvider:
        provider_name = "openbb_alpha_vantage"
        supports_targeted_price_repair = True

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            return {
                "source": "openbb_alpha_vantage",
                "bars": [
                    {"date": "2026-04-01", "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "adj_close": 100.25, "volume": 1000}
                ],
                "actions": [],
            }

    providers = [
        _FailingProvider("yahoo"),
        _FailingProvider("yfinance"),
        _OpenBBAlphaTargetedProvider(),
    ]

    provider = RuntimeMarketDataProvider(providers, allow_targeted_price_repair=True)
    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 1))

    assert result["source"] == "openbb_alpha_vantage"
    openbb_result = next(
        item for item in result["metadata"]["provider_results"] if item["provider"] == "openbb_alpha_vantage"
    )
    assert openbb_result["kind"] == "targeted_price_repair"
    assert openbb_result["selection_status"] == "selected_primary"


def test_openbb_bond_provider_fills_missing_curve_rows_and_cross_checks_existing(monkeypatch):
    def official_provider(*, today):
        return {
            "snapshots": [
                {
                    "id": "bond_fixed_income::UST_CMT_10Y::2026-04-01::us_treasury_xml",
                    "instrument_id": "UST_CMT_10Y",
                    "symbol": "UST10Y",
                    "name": "US Treasury CMT 10Y",
                    "instrument_type": "treasury_cmt",
                    "currency": "USD",
                    "snapshot_date": "2026-04-01",
                    "clean_price": 100.0,
                    "net_price": 100.0,
                    "dirty_price": 100.0,
                    "full_price": 100.0,
                    "accrued_interest": 0.0,
                    "ytm_pct": 4.3,
                    "duration": 9.6,
                    "convexity": 1.0,
                    "source": "us_treasury_xml",
                    "source_snapshot_id": "bond_fixed_income::UST_CMT_10Y::2026-04-01::us_treasury_xml",
                    "refresh_status": "READY",
                    "missing_fields": [],
                    "inferred_fields": {},
                    "raw": {},
                }
            ],
            "warnings": [],
            "errors": [],
            "telemetry": {},
        }

    def yield_curve(**kwargs):
        curve_type = kwargs.get("yield_curve_type")
        if curve_type == "real":
            return SimpleNamespace(results=[{"date": "2026-04-01", "year_5": 1.9, "year_10": 2.0}])
        return SimpleNamespace(results=[{"date": "2026-04-01", "year_2": 4.1, "year_10": 4.4, "year_30": 4.6}])

    fake_obb = SimpleNamespace(
        user=SimpleNamespace(credentials=SimpleNamespace()),
        fixedincome=SimpleNamespace(government=SimpleNamespace(yield_curve=yield_curve)),
    )
    monkeypatch.setattr("grit_backtest_platform.openbb_provider._load_obb", lambda: fake_obb)

    provider = OpenBBBondFixedIncomeProvider(
        official_provider=official_provider,
        openbb_providers=("federal_reserve",),
    )
    result = provider.fetch_snapshots(as_of_date=date(2026, 4, 1))
    snapshots = {item["instrument_id"]: item for item in result["snapshots"]}

    assert snapshots["UST_CMT_2Y"]["source"] == "openbb_federal_reserve"
    assert snapshots["UST_CMT_30Y"]["source"] == "openbb_federal_reserve"
    assert snapshots["TIPS_10Y"]["source"] == "openbb_federal_reserve"
    assert snapshots["UST_CMT_10Y"]["source"] == "us_treasury_xml"
    assert snapshots["UST_CMT_10Y"]["raw"]["openbb_cross_checks"][0]["provider"] == "openbb_federal_reserve"
    assert result["provider_results"][-1]["filled_instrument_count"] == 4
    assert result["provider_results"][-1]["cross_checked_instrument_count"] == 1


def test_openbb_bond_provider_falls_back_when_generated_fixedincome_route_mismatches(monkeypatch):
    def official_provider(*, today):
        return {"snapshots": [], "warnings": [], "errors": [], "telemetry": {}}

    class _BrokenFixedIncomeObb:
        user = SimpleNamespace(credentials=SimpleNamespace())

        @property
        def fixedincome(self):
            raise ImportError(
                "cannot import name 'OBBject_BondIndices' from "
                "'openbb_core.app.provider_interface'"
            )

    calls: list[tuple[str, bool]] = []

    def fake_direct_records(*, openbb_provider, as_of_date, real):
        calls.append((openbb_provider, real))
        if real:
            return [{"date": "2026-04-01", "maturity": "year_10", "rate": 0.02}]
        return [
            {"date": "2026-04-01", "maturity": "year_2", "rate": 0.041},
            {"date": "2026-04-01", "maturity": "year_10", "rate": 0.044},
        ]

    monkeypatch.setattr("grit_backtest_platform.openbb_provider._load_obb", lambda: _BrokenFixedIncomeObb())
    monkeypatch.setattr(
        "grit_backtest_platform.openbb_provider._fetch_openbb_yield_curve_records_direct",
        fake_direct_records,
    )

    provider = OpenBBBondFixedIncomeProvider(
        official_provider=official_provider,
        openbb_providers=("federal_reserve",),
    )
    result = provider.fetch_snapshots(as_of_date=date(2026, 4, 1))
    snapshots = {item["instrument_id"]: item for item in result["snapshots"]}

    assert calls == [("federal_reserve", False), ("federal_reserve", True)]
    assert snapshots["UST_CMT_2Y"]["ytm_pct"] == pytest.approx(4.1)
    assert snapshots["UST_CMT_10Y"]["ytm_pct"] == pytest.approx(4.4)
    assert snapshots["TIPS_10Y"]["ytm_pct"] == pytest.approx(2.0)
    assert result["provider_results"][-1]["status"] == "succeeded"
    assert result["provider_results"][-1]["filled_instrument_count"] == 3


def test_lqd_snapshot_uses_markets_insider_tracking_error(monkeypatch):
    def fake_fetch_text(url: str, *, timeout: float = 20.0) -> str:
        if "markets.businessinsider.com" in url:
            return "Tracking Error 1 Year 1.64 Tracking Error 3 Years 2.70"
        if "dataType=fund" in url:
            return "\n".join(
                [
                    "Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Par Value,CUSIP,ISIN,SEDOL,Price,Location,Exchange,Currency,Duration,YTM (%)",
                    "Sample Bond,Corporate,Bond,100,100,100,100,123456789,US1234567890,SEDOL,98.25,US,,USD,8.1,5.4",
                ]
            )
        return """
        30 Day SEC Yield as of Apr 30, 2026  5.15%
        Effective Duration as of May 01, 2026  8.00
        Average Yield to Maturity as of May 01, 2026  5.27%
        var tabsRatingDataTable = [{"name":"AAA","value":1.1},{"name":"AA ","value":7.2},{"name":"A ","value":42.3},{"name":"BBB","value":48.4}];
        """

    monkeypatch.setattr("grit_backtest_platform._bond_fixed_income_provider._fetch_text", fake_fetch_text)

    snapshot = _lqd_snapshot(fetched_at="2026-05-04T00:00:00Z", timeout=1.0)

    assert snapshot is not None
    assert snapshot["refresh_status"] == "READY"
    assert snapshot["missing_fields"] == []
    assert snapshot["duration"] == 8.0
    assert snapshot["raw"]["tracking_error_bps"] == 164.0
    assert snapshot["raw"]["tracking_error_source"] == "MARKETS_INSIDER"
    assert snapshot["raw"]["tracking_status"] == "READY"
    assert snapshot["raw"]["tracking_error_period"] == "1Y"


def test_openbb_universe_current_constituents_are_auxiliary_only(monkeypatch):
    monkeypatch.setenv("FMP_API_KEY", "token")
    fake_obb = SimpleNamespace(
        user=SimpleNamespace(credentials=SimpleNamespace()),
        index=SimpleNamespace(
            constituents=lambda **kwargs: SimpleNamespace(
                results=[{"symbol": "AAPL"}, {"symbol": "MSFT"}, {"symbol": "NVDA"}]
            )
        ),
    )
    monkeypatch.setattr("grit_backtest_platform.openbb_provider._load_obb", lambda: fake_obb)

    provider = OpenBBCurrentUniverseConstituentCheckProvider()
    result = provider.check_current_constituents(
        universe_key="sp500",
        universe_name="S&P 500",
        symbols=["AAPL", "MSFT", "TSLA"],
    )

    assert result["provider"] == "openbb_index_constituents"
    assert result["status"] == "succeeded"
    assert result["matched_latest_anchor_count"] == 2
    assert result["auxiliary_only"] is True


def test_tiingo_symbology_provider_resolves_identity(monkeypatch):
    monkeypatch.setenv("TIINGO_API_TOKEN", "token")
    provider = TiingoSymbologyProvider()

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        assert "tiingo/utilities/search" in url
        assert "query=AAPL" in url
        assert "token=token" in url
        return _FakeHttpResponse(
            json.dumps(
                [
                    {
                        "ticker": "AAPL",
                        "name": "Apple Inc.",
                        "exchangeCode": "NASDAQ",
                        "startDate": "1980-12-12",
                        "permaTicker": "AAPL.US",
                    }
                ]
            )
        )

    monkeypatch.setattr("grit_backtest_platform.tiingo_symbology_provider.urllib.request.urlopen", fake_urlopen)

    identity = provider.resolve_identity("AAPL.US")

    assert provider.availability().available is True
    assert identity is not None
    assert identity["symbol"] == "AAPL"
    assert identity["canonical_symbol"] == "AAPL.US"
    assert identity["company_name"] == "Apple Inc."
    assert identity["source"] == "tiingo_symbology"


def test_tiingo_symbology_provider_requires_exact_symbol_match_for_short_tickers(monkeypatch):
    monkeypatch.setenv("TIINGO_API_TOKEN", "token")
    provider = TiingoSymbologyProvider()

    def fake_urlopen(request, timeout=0):
        return _FakeHttpResponse(
            json.dumps(
                [
                    {
                        "ticker": "DAYXX",
                        "tickerRegion": "DAYXX.US",
                        "name": "Unrelated Day Holdings",
                        "exchangeCode": "NASDAQ",
                        "assetType": "Stock",
                    },
                    {
                        "ticker": "MMC.A",
                        "tickerRegion": "MMCA.US",
                        "name": "Unrelated MMCA",
                        "exchangeCode": "NYSE",
                        "assetType": "Stock",
                    },
                ]
            )
        )

    monkeypatch.setattr("grit_backtest_platform.tiingo_symbology_provider.urllib.request.urlopen", fake_urlopen)

    assert provider.resolve_identity("DAY") is None
    assert provider.resolve_identity("MMC") is None


def test_longbridge_provider_supports_probe_identity_and_history(monkeypatch):
    monkeypatch.setenv("LONGBRIDGE_APP_KEY", "app-key")
    monkeypatch.setenv("LONGBRIDGE_APP_SECRET", "app-secret")
    monkeypatch.setenv("LONGBRIDGE_ACCESS_TOKEN", "access-token")

    fake_openapi = SimpleNamespace()

    class _FakeConfig:
        @classmethod
        def from_apikey(cls, app_key, app_secret, access_token):
            return {"app_key": app_key, "app_secret": app_secret, "access_token": access_token}

    class _FakeQuoteContext:
        create_calls = 0

        def __init__(self, config):
            self.config = config
            self.calls: list[tuple[str, tuple, dict]] = []

        @classmethod
        def create(cls, config):
            cls.create_calls += 1
            return cls(config)

        def quote(self, symbols):
            self.calls.append(("quote", tuple(symbols), {}))
            return {"secu_quote": [{"symbol": symbols[0], "last_done": 200.0}]}

        def static_info(self, symbols):
            self.calls.append(("static_info", tuple(symbols), {}))
            return {
                "secu_static_info": [
                    {
                        "symbol": symbols[0],
                        "name_en": "Apple Inc.",
                        "exchange": "NASD",
                        "listing_date": "1980-12-12",
                    }
                ]
            }

        def history_candlesticks_by_date(self, symbol, period, adjust_type, start_date, end_date):
            self.calls.append(("history_candlesticks_by_date", (symbol, period, adjust_type, start_date, end_date), {}))
            return {
                "candlesticks": [
                    {"date": "2026-04-01", "open": 100.0, "high": 101.0, "low": 99.5, "close": 100.5, "volume": 1000},
                    {"date": "2026-04-02", "open": 100.5, "high": 102.0, "low": 100.0, "close": 101.5, "volume": 1100},
                ]
            }

    fake_openapi.Config = _FakeConfig
    fake_openapi.QuoteContext = _FakeQuoteContext
    fake_openapi.Period = SimpleNamespace(Day="Day")
    fake_openapi.AdjustType = SimpleNamespace(NoAdjust="NoAdjust")

    longbridge_pkg = SimpleNamespace(openapi=fake_openapi)
    monkeypatch.setitem(sys.modules, "longbridge", longbridge_pkg)
    monkeypatch.setitem(sys.modules, "longbridge.openapi", fake_openapi)

    provider = LongbridgeQuoteProvider()
    static_provider = LongbridgeStaticInfoProvider()

    availability = provider.availability()
    identity = static_provider.resolve_identity("AAPL")
    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))

    assert availability.available is True
    assert identity is not None
    assert identity["symbol"] == "AAPL"
    assert identity["canonical_symbol"] == "AAPL.US"
    assert result.source == "longbridge"
    assert result.partial is False
    assert [bar.date for bar in result.bars] == ["2026-04-01", "2026-04-02"]
    assert result.metadata["supports_post_2010_history"] is True
    assert _FakeQuoteContext.create_calls == 1


def test_longbridge_provider_rejects_pre_2010_history(monkeypatch):
    monkeypatch.setenv("LONGBRIDGE_APP_KEY", "app-key")
    monkeypatch.setenv("LONGBRIDGE_APP_SECRET", "app-secret")
    monkeypatch.setenv("LONGBRIDGE_ACCESS_TOKEN", "access-token")

    provider = LongbridgeQuoteProvider()

    try:
        provider.fetch_history("AAPL", date(2009, 12, 31), date(2010, 6, 1))
    except RuntimeError as exc:
        assert "2010-06-01" in str(exc)
    else:
        raise AssertionError("Expected Longbridge to reject pre-2010 history")


def test_longbridge_provider_parses_list_payload_rows_without_mapping(monkeypatch):
    monkeypatch.setenv("LONGBRIDGE_APP_KEY", "app-key")
    monkeypatch.setenv("LONGBRIDGE_APP_SECRET", "app-secret")
    monkeypatch.setenv("LONGBRIDGE_ACCESS_TOKEN", "access-token")

    fake_openapi = SimpleNamespace()

    class _FakeConfig:
        @classmethod
        def from_apikey(cls, app_key, app_secret, access_token):
            return {"app_key": app_key, "app_secret": app_secret, "access_token": access_token}

    class _FakeCandlestick:
        __slots__ = ("open", "high", "low", "close", "volume", "timestamp", "trade_session")

        def __init__(self, *, open_value, high, low, close, volume, timestamp):
            self.open = open_value
            self.high = high
            self.low = low
            self.close = close
            self.volume = volume
            self.timestamp = timestamp
            self.trade_session = "Intraday"

    class _FakeQuoteContext:
        @classmethod
        def create(cls, config):
            return cls()

        def quote(self, symbols):
            return [{"symbol": symbols[0], "last_done": 200.0}]

        def static_info(self, symbols):
            return [{"symbol": symbols[0], "name_en": "Apple Inc.", "exchange": "NASD"}]

        def history_candlesticks_by_date(self, symbol, period, adjust_type, start_date, end_date):
            return [
                _FakeCandlestick(
                    open_value=100.0,
                    high=101.0,
                    low=99.5,
                    close=100.5,
                    volume=1000,
                    timestamp="2026-04-01 12:00:00",
                ),
                _FakeCandlestick(
                    open_value=100.5,
                    high=102.0,
                    low=100.0,
                    close=101.5,
                    volume=1100,
                    timestamp="2026-04-02 12:00:00",
                ),
            ]

    fake_openapi.Config = _FakeConfig
    fake_openapi.QuoteContext = _FakeQuoteContext
    fake_openapi.Period = SimpleNamespace(Day="Day")
    fake_openapi.AdjustType = SimpleNamespace(NoAdjust="NoAdjust")

    longbridge_pkg = SimpleNamespace(openapi=fake_openapi)
    monkeypatch.setitem(sys.modules, "longport.openapi", fake_openapi)
    monkeypatch.setitem(sys.modules, "longbridge", longbridge_pkg)
    monkeypatch.setitem(sys.modules, "longbridge.openapi", fake_openapi)
    import grit_backtest_platform.longbridge_provider as longbridge_provider_module
    longbridge_provider_module._LONGBRIDGE_CLIENTS.clear()

    provider = LongbridgeQuoteProvider()
    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))

    assert [bar.date for bar in result.bars] == ["2026-04-01", "2026-04-02"]
    assert result.bars[0].open == 100.0
    assert result.bars[1].close == 101.5


def test_longbridge_provider_normalizes_class_share_symbol_and_marks_quota_limit(monkeypatch):
    monkeypatch.setenv("LONGBRIDGE_APP_KEY", "app-key")
    monkeypatch.setenv("LONGBRIDGE_APP_SECRET", "app-secret")
    monkeypatch.setenv("LONGBRIDGE_ACCESS_TOKEN", "access-token")

    fake_openapi = SimpleNamespace()

    class _FakeConfig:
        @classmethod
        def from_apikey(cls, app_key, app_secret, access_token):
            return {"app_key": app_key, "app_secret": app_secret, "access_token": access_token}

    class _OpenApiException(RuntimeError):
        pass

    class _FakeQuoteContext:
        @classmethod
        def create(cls, config):
            return cls()

        def quote(self, symbols):
            return [{"symbol": symbols[0], "last_done": 200.0}]

        def static_info(self, symbols):
            symbol = symbols[0]
            if symbol == "BRK.B.US":
                return [{"symbol": symbol, "name_en": "Berkshire Hathaway Inc.", "exchange": "NYSE"}]
            return []

        def history_candlesticks_by_date(self, symbol, period, adjust_type, start_date, end_date):
            raise _OpenApiException(
                "OpenApiException: (kind=ErrorKind.OpenApi, code=301607, trace_id=) history kline symbol count out of limit"
            )

    fake_openapi.Config = _FakeConfig
    fake_openapi.QuoteContext = _FakeQuoteContext
    fake_openapi.Period = SimpleNamespace(Day="Day")
    fake_openapi.AdjustType = SimpleNamespace(NoAdjust="NoAdjust")

    longbridge_pkg = SimpleNamespace(openapi=fake_openapi)
    monkeypatch.setitem(sys.modules, "longport.openapi", fake_openapi)
    monkeypatch.setitem(sys.modules, "longbridge", longbridge_pkg)
    monkeypatch.setitem(sys.modules, "longbridge.openapi", fake_openapi)
    import grit_backtest_platform.longbridge_provider as longbridge_provider_module
    longbridge_provider_module._LONGBRIDGE_CLIENTS.clear()

    provider = LongbridgeQuoteProvider()
    static_provider = LongbridgeStaticInfoProvider()

    identity = static_provider.resolve_identity("BRK-B")
    assert identity is not None
    assert identity["symbol"] == "BRK-B"
    assert identity["canonical_symbol"] == "BRK.B.US"

    try:
        provider.fetch_history("BRK-B", date(2026, 4, 1), date(2026, 4, 10))
    except ProviderExecutionSignal as exc:
        assert exc.status == "limited"
        assert exc.reason == "history_kline_symbol_count_out_of_limit"
    else:
        raise AssertionError("Expected Longbridge quota limit to surface as a structured provider signal")


def test_akshare_us_provider_parses_records(monkeypatch):
    fake_module = SimpleNamespace()

    def stock_us_daily(symbol):
        assert symbol == "AAPL"
        return [
            {
                "日期": "2026-04-01",
                "开盘": "100.0",
                "最高": "101.5",
                "最低": "99.0",
                "收盘": "100.5",
                "复权": "100.4",
                "成交量": "1000",
            },
            {
                "date": "2026-04-02",
                "open": 101.0,
                "high": 102.0,
                "low": 100.0,
                "close": 101.5,
                "adj_close": 101.3,
                "volume": 1100,
            },
        ]

    fake_module.stock_us_daily = stock_us_daily
    monkeypatch.setitem(sys.modules, "akshare", fake_module)

    provider = AkshareUsPriceProvider()
    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))

    assert provider.availability().available is True
    assert result.source == "akshare_us"
    assert [bar.date for bar in result.bars] == ["2026-04-01", "2026-04-02"]
    assert result.bars[0].adj_close == 100.4
    assert result.bars[1].adj_close == 101.3
    assert result.metadata["actions_supported"] is False


def test_alpha_vantage_provider_parses_dividends_and_splits(monkeypatch):
    monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "token")
    provider = AlphaVantageProvider()

    def fake_urlopen(request, timeout=0):
        url = _request_url(request)
        parsed = urllib.parse.urlparse(url)
        params = urllib.parse.parse_qs(parsed.query)
        function = params.get("function", [""])[0]
        if function == "DIVIDENDS":
            return _FakeHttpResponse(
                json.dumps(
                    {
                        "data": [
                            {
                                "ex_dividend_date": "2026-04-01",
                                "amount": "0.24",
                                "record_date": "2026-04-02",
                                "payment_date": "2026-04-15",
                            }
                        ]
                    }
                )
            )
        if function == "SPLITS":
            return _FakeHttpResponse(
                json.dumps(
                    {
                        "data": [
                            {
                                "effective_date": "2026-04-02",
                                "split_from": "1",
                                "split_to": "2",
                            },
                            {
                                "effective_date": "2026-04-03",
                                "split_from": "4",
                                "split_to": "1",
                            },
                        ]
                    }
                )
            )
        raise AssertionError(f"Unexpected Alpha Vantage request: {url}")

    monkeypatch.setattr("grit_backtest_platform.alpha_vantage_provider.urllib.request.urlopen", fake_urlopen)

    result = provider.fetch_corporate_actions("AAPL", date(2026, 4, 1), date(2026, 4, 3))

    assert result["source"] == "alpha_vantage"
    assert result["probe_complete"] is True
    assert result["metadata"]["actions_supported"] is True
    assert result["metadata"]["access_tier"] == "free_account"
    assert {item["action_type"] for item in result["actions"]} == {
        "dividend",
        "split",
        "reverse_split",
    }


def test_alpha_vantage_corporate_action_rate_limit_exposes_retry_metadata(monkeypatch):
    monkeypatch.setenv("ALPHAVANTAGE_API_KEY", "token")
    provider = AlphaVantageProvider()

    def fake_urlopen(request, timeout=0):
        return _FakeHttpResponse(
            json.dumps(
                {
                    "Note": (
                        "Thank you for using Alpha Vantage! "
                        "Our standard API call frequency is 25 requests per day."
                    )
                }
            )
        )

    monkeypatch.setattr("grit_backtest_platform.alpha_vantage_provider.urllib.request.urlopen", fake_urlopen)

    with pytest.raises(ProviderExecutionSignal) as exc:
        provider.fetch_corporate_actions("AAPL", date(2026, 4, 1), date(2026, 4, 3))

    assert exc.value.status == "limited"
    assert exc.value.reason == "rate_limited"
    assert exc.value.metadata["quota_limited"] is True
    assert isinstance(exc.value.metadata["next_retry_at"], str)


def test_tiingo_provider_429_emits_retry_metadata(monkeypatch):
    monkeypatch.setenv("TIINGO_API_TOKEN", "token")
    provider = TiingoMarketDataProvider(timeout=1)

    def fake_urlopen(request, timeout=0):
        raise urllib.error.HTTPError(
            url=_request_url(request),
            code=429,
            msg="Too Many Requests",
            hdrs={"Retry-After": "120"},
            fp=io.BytesIO(b'{"detail":"Rate limit exceeded"}'),
        )

    monkeypatch.setattr("grit_backtest_platform.tiingo_provider.urllib.request.urlopen", fake_urlopen)

    with pytest.raises(ProviderExecutionSignal) as exc:
        provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))

    assert exc.value.status == "limited"
    assert exc.value.reason == "rate_limited"
    assert exc.value.metadata["quota_limited"] is True
    assert isinstance(exc.value.metadata["next_retry_at"], str)


def test_runtime_market_data_provider_records_alpha_vantage_probe_after_public_price_success():
    class _YahooProvider:
        provider_name = "yahoo"
        supports_action_enrichment = True

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            return {
                "source": "yahoo",
                "fallback_source": None,
                "bars": [
                    {
                        "date": "2026-04-01",
                        "open": 100.0,
                        "high": 101.0,
                        "low": 99.0,
                        "close": 100.5,
                        "adj_close": 100.5,
                        "volume": 1000,
                    }
                ],
                "actions": [],
                "warnings": [],
                "partial": False,
                "metadata": {"provider": "yahoo"},
            }

    class _TiingoProvider:
        provider_name = "tiingo"
        supports_action_enrichment = True

        def __init__(self) -> None:
            self.called = False

        def fetch_history(self, symbol: str, start_date: date, end_date: date):
            self.called = True
            raise AssertionError("Tiingo should be skipped once Yahoo completed the probe.")

    class _AlphaProbeProvider:
        provider_name = "alpha_vantage"

        def __init__(self) -> None:
            self.called = False

        def fetch_corporate_actions(self, symbol: str, start_date: date, end_date: date):
            self.called = True
            return {
                "source": "alpha_vantage",
                "actions": [],
                "probe_complete": True,
                "metadata": {
                    "actions_supported": True,
                    "probe_complete": True,
                    "access_tier": "free_account",
                    "quota_limited": False,
                },
            }

    tiingo = _TiingoProvider()
    alpha_probe = _AlphaProbeProvider()
    runtime = RuntimeMarketDataProvider([_YahooProvider(), tiingo, alpha_probe])

    result = runtime.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))
    provider_results = result["metadata"]["provider_results"]

    assert tiingo.called is False
    assert alpha_probe.called is True
    assert any(
        item["provider"] == "tiingo"
        and item["kind"] == "history"
        and item["status"] == "skipped"
        and item["reason"] == "primary_price_source_already_selected"
        for item in provider_results
    )
    assert any(
        item["provider"] == "alpha_vantage"
        and item["kind"] == "history_availability"
        and item["status"] == "succeeded"
        and item["probe_complete"] is True
        and item["access_tier"] == "free_account"
        for item in provider_results
    )

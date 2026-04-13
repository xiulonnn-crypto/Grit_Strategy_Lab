from __future__ import annotations

import json
import sys
import urllib.parse
from types import ModuleType, SimpleNamespace
from datetime import date

_fmp_stub = ModuleType("grit_backtest_platform.fmp_constituent_provider")
if not hasattr(_fmp_stub, "FmpHistoricalConstituentUniverseHistoryProvider"):
    _fmp_stub.FmpHistoricalConstituentUniverseHistoryProvider = type(
        "FmpHistoricalConstituentUniverseHistoryProvider",
        (),
        {},
    )
sys.modules.setdefault("grit_backtest_platform.fmp_constituent_provider", _fmp_stub)

import grit_backtest_platform.api as api_module
from grit_backtest_platform.alpha_vantage_provider import AlphaVantageProvider
from grit_backtest_platform.api import RuntimeMarketDataProvider
from grit_backtest_platform.akshare_us_provider import AkshareUsPriceProvider
from grit_backtest_platform.fallback_provider import ProviderAvailability, SequentialMarketDataProviderChain
from grit_backtest_platform.fmp_identity_provider import FmpIdentityRepairProvider
from grit_backtest_platform.longbridge_provider import LongbridgeQuoteProvider, LongbridgeStaticInfoProvider
from grit_backtest_platform.sec_edgar_provider import SecEdgarProvider
from grit_backtest_platform.tiingo_provider import TiingoMarketDataProvider
from grit_backtest_platform.tiingo_symbology_provider import TiingoSymbologyProvider

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
    assert result["actions"][0]["value"] == 0.25
    assert result["actions"][0]["payload"]["from"] == "yahoo"
    assert result["actions"][0]["payload"]["cash"] == 0.25
    assert result["actions"][0]["fallback_source"] == "tiingo"


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

    provider = RuntimeMarketDataProvider([_YahooProvider(), _TiingoProvider(), _AkshareProvider()])

    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 1))

    assert calls == ["yahoo", "tiingo"]
    assert result["source"] == "yahoo"
    assert len(result["bars"]) == 1
    assert len(result["actions"]) == 1


def test_runtime_market_data_provider_builder_orders_price_and_identity_sources(monkeypatch):
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
    monkeypatch.setattr(api_module, "_load_provider", lambda module_name, class_names: providers.get((module_name, class_names)))

    runtime = api_module.build_runtime_market_data_provider()

    assert [getattr(provider, "provider_name", "") for provider in runtime.providers] == [
        "yahoo",
        "tiingo",
        "tiingo_symbology",
        "longbridge_static_info",
        "longbridge",
        "akshare_us",
        "fmp",
        "alpha_vantage",
        "sec_edgar",
    ]
    assert [provider.provider_name for provider in runtime.price_providers] == [
        "yahoo",
        "tiingo",
        "longbridge",
        "akshare_us",
        "fmp",
    ]
    assert [provider.provider_name for provider in runtime.identity_providers] == [
        "tiingo_symbology",
        "longbridge_static_info",
        "fmp",
        "alpha_vantage",
    ]
    assert runtime.fallback_provider.provider_name == "tiingo"


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

    monkeypatch.setitem(sys.modules, "longport.openapi", fake_openapi)
    monkeypatch.setitem(sys.modules, "longbridge.openapi", fake_openapi)

    provider = LongbridgeQuoteProvider()
    result = provider.fetch_history("AAPL", date(2026, 4, 1), date(2026, 4, 2))

    assert [bar.date for bar in result.bars] == ["2026-04-01", "2026-04-02"]
    assert result.bars[0].open == 100.0
    assert result.bars[1].close == 101.5


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

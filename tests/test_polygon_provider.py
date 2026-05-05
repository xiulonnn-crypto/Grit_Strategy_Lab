from __future__ import annotations

from datetime import date

from grit_backtest_platform.polygon_provider import PolygonMarketDataProvider


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

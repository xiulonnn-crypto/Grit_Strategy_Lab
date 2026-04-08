from __future__ import annotations

from grit_backtest_platform._storage_restored import SQLiteStorage
from grit_backtest_platform.market_data_repository import MarketDataRepository


def test_symbol_identity_cache_round_trips_and_storage_schema_exists(tmp_path):
    repository = MarketDataRepository(tmp_path / "market.sqlite3")
    repository.upsert_symbol_identity(
        {
            "symbol": "twtr",
            "canonical_symbol": "TWTR",
            "company_name": "Twitter, Inc.",
            "cik": "0001418091",
            "exchange": "NYSE",
            "ipo_date": "2013-11-07",
            "delisting_date": "2022-10-28",
            "source": "fmp",
            "valid_from": "2013-11-07",
            "valid_to": "2022-10-28",
        }
    )

    loaded = repository.load_symbol_identity("TWTR")
    assert loaded is not None
    assert loaded["symbol"] == "TWTR"
    assert loaded["canonical_symbol"] == "TWTR"
    assert loaded["company_name"] == "Twitter, Inc."
    assert loaded["cik"] == "0001418091"
    assert loaded["delisting_date"] == "2022-10-28"

    repository.replace_symbol_identity_cache(
        [
            {
                "symbol": "aapl",
                "company_name": "Apple Inc.",
                "source": "sec_edgar",
            },
            {
                "symbol": "msft",
                "company_name": "Microsoft Corporation",
                "source": "sec_edgar",
            },
        ]
    )
    cached_symbols = [row["symbol"] for row in repository.list_symbol_identity_cache()]
    assert cached_symbols == ["AAPL", "MSFT"]
    assert repository.list_symbol_identity_cache(["msft"])[0]["company_name"] == "Microsoft Corporation"

    storage = SQLiteStorage(tmp_path / "platform.sqlite3")
    tables = {row["name"] for row in storage.fetch_all("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert "symbol_identity_cache" in tables


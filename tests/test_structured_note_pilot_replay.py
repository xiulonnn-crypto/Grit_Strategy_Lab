from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from grit_backtest_platform.market_data_repository import DATASET_PRICE_SNAPSHOT_ID
from grit_backtest_platform.sec_edgar_provider import SecEdgarProvider
from tests.api_test_support import assert_ok, create_test_client
from tests.test_sec_424b2_parser import JPM_424B2_HTML, JPM_LONG_LABEL_424B2_HTML


def _runtime_dir(name: str) -> Path:
    path = Path(".tmp") / "pytest-runtime" / f"{name}-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _filing(accession: str, document: str = "form424b2.htm") -> dict[str, str]:
    compact = accession.replace("-", "")
    return {
        "accession_number": accession,
        "primary_document": document,
        "primary_document_url": f"https://www.sec.gov/Archives/edgar/data/19617/{compact}/{document}",
    }


def _seed_price_snapshot(service, rows: list[dict]) -> None:
    service.market_data_repository.replace_dataset_snapshot(
        {
            "id": DATASET_PRICE_SNAPSHOT_ID,
            "kind": "DATASET",
            "name": "PIT price bars",
            "status": "READY",
            "source": "test_seed",
            "row_count": len(rows),
            "metadata": {"test_seed": "structured_note_replay"},
        },
        price_bars=rows,
    )


def _price_rows(symbols: list[str], dates: list[str], values_by_symbol: dict[str, list[float]]) -> list[dict]:
    rows: list[dict] = []
    for symbol in symbols:
        for date, value in zip(dates, values_by_symbol[symbol]):
            rows.append(
                {
                    "symbol": symbol,
                    "date": date,
                    "open": value,
                    "high": value,
                    "low": value,
                    "close": value,
                    "adj_close": value,
                    "volume": 1_000_000,
                }
            )
    return rows


def test_sec_424b2_pilot_discovery_and_ingest_pin_jpm_manifest(monkeypatch, tmp_path) -> None:
    filings = [_filing("0001918704-26-014078")] + [
        _filing(f"0001918704-26-01408{i}") for i in range(1, 10)
    ]
    html_by_url = {
        filings[0]["primary_document_url"]: JPM_LONG_LABEL_424B2_HTML,
        **{filing["primary_document_url"]: JPM_424B2_HTML for filing in filings[1:]},
    }

    monkeypatch.setattr(SecEdgarProvider, "fetch_424b2_filings_by_cik", lambda self, cik, limit=20: filings[:limit])
    monkeypatch.setattr(SecEdgarProvider, "fetch_archive_document", lambda self, url: html_by_url[url])
    client, _db_path = create_test_client(_runtime_dir("sec-424b2-pilot"))

    preview = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/pilot/discover-preview",
            json={"issuer_cik": "0001665650", "scan_limit": 10, "pilot_limit": 8},
        )
    )

    assert preview["selected_count"] == 8
    sentinel = next(item for item in preview["entries"] if item["accession_number"] == "0001918704-26-014078")
    assert sentinel["underlying_tickers"] == ["RTY", "SPX", "KRE"]
    assert sentinel["coupon_rate_annual"] == 0.098
    assert sentinel["barrier_percentage"] == 0.7
    assert sentinel["price_proxies"]["RTY"]["price_proxy_symbol"] == "IWM"

    entries = [
        {**entry, "html": html_by_url[entry["source_url"]]}
        for entry in preview["entries"]
    ]
    manifest_path = tmp_path / "jpm_manifest.json"
    ingested = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/pilot/ingest",
            json={"manifest_path": str(manifest_path), "entries": entries, "persist": True, "pilot_limit": 8},
        )
    )

    assert manifest_path.exists()
    assert ingested["selected_count"] == 8
    assert ingested["parse_run_count"] == 8
    assert ingested["summary"]["parser_rule_hash"]


def test_fcn_replay_outputs_coupon_signal_and_blocks_missing_prices() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-replay"))
    parsed = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/parse-preview",
            json={
                "issuer_cik": "0001665650",
                "accession_number": "0001918704-26-014078",
                "html": JPM_424B2_HTML,
                "persist": True,
            },
        )
    )
    dates = ["2026-01-30", "2026-02-27", "2026-03-31"]
    _seed_price_snapshot(
        client.app.state.service,
        _price_rows(
            ["NVDA", "MSFT", "TSLA"],
            dates,
            {
                "NVDA": [100.0, 80.0, 50.0],
                "MSFT": [200.0, 150.0, 100.0],
                "TSLA": [300.0, 240.0, 150.0],
            },
        ),
    )

    replay = assert_ok(
        client.post(
            "/structured-notes/fcn/replay",
            json={
                "parse_run_id": parsed["parse_run"]["run_id"],
                "start_date": "2026-01-01",
                "end_date": "2026-03-31",
                "observation_frequency": "Monthly",
            },
        )
    )

    assert replay["status"] == "OK"
    assert [point["note_date"] for point in replay["points"]] == dates
    assert replay["points"][0]["coupon_eligible"] is True
    assert replay["points"][0]["coupon_signal"] == 0.135 / 12
    assert replay["points"][-1]["coupon_eligible"] is False
    assert replay["points"][-1]["coupon_signal"] == 0.0

    _seed_price_snapshot(
        client.app.state.service,
        _price_rows(["NVDA"], dates, {"NVDA": [100.0, 80.0, 50.0]}),
    )
    blocked = assert_ok(
        client.post(
            "/structured-notes/fcn/replay",
            json={
                "parse_run_id": parsed["parse_run"]["run_id"],
                "start_date": "2026-01-01",
                "end_date": "2026-03-31",
            },
        )
    )
    assert blocked["status"] == "DATA_SOURCE_BLOCKED"
    assert set(blocked["summary"]["missing_symbols"]) == {"MSFT", "TSLA"}


def test_fcn_replay_uses_sandbox_only_price_proxies_without_changing_underlying_identity() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-proxy-replay"))
    parsed = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/parse-preview",
            json={
                "issuer_cik": "0001665650",
                "accession_number": "0001918704-26-014078",
                "html": JPM_LONG_LABEL_424B2_HTML,
                "persist": True,
            },
        )
    )
    dates = ["2026-01-30", "2026-02-27"]
    _seed_price_snapshot(
        client.app.state.service,
        _price_rows(
            ["IWM", "SPY", "KRE"],
            dates,
            {
                "IWM": [100.0, 95.0],
                "SPY": [100.0, 96.0],
                "KRE": [100.0, 97.0],
            },
        ),
    )

    proxies = {
        "RTY": {"price_proxy_symbol": "IWM", "proxy_mode": "SANDBOX_ONLY"},
        "SPX": {"price_proxy_symbol": "SPY", "proxy_mode": "SANDBOX_ONLY"},
    }
    sandbox = assert_ok(
        client.post(
            "/structured-notes/fcn/replay",
            json={
                "parse_run_id": parsed["parse_run"]["run_id"],
                "start_date": "2026-01-01",
                "end_date": "2026-02-28",
                "price_proxies": proxies,
            },
        )
    )
    assert sandbox["status"] == "OK"
    assert set(parsed["note"]["underlying_tickers"]) == {"RTY", "SPX", "KRE"}

    production = assert_ok(
        client.post(
            "/structured-notes/fcn/replay",
            json={
                "parse_run_id": parsed["parse_run"]["run_id"],
                "start_date": "2026-01-01",
                "end_date": "2026-02-28",
                "replay_mode": "production",
                "price_proxies": proxies,
            },
        )
    )
    assert production["status"] == "DATA_SOURCE_BLOCKED"
    assert set(production["summary"]["missing_symbols"]) == {"RTY", "SPX"}

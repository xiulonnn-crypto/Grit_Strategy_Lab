from __future__ import annotations

import logging
from pathlib import Path
from uuid import uuid4

from grit_backtest_platform.market_data_repository import DATASET_PRICE_SNAPSHOT_ID
from tests.api_test_support import assert_ok, create_test_client
from tests.test_sec_424b2_parser import JPM_PRICING_SUPPLEMENT_INITIAL_VALUES_HTML


def _runtime_dir(name: str) -> Path:
    path = Path(".tmp") / "pytest-runtime" / f"{name}-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _multi_leg_html(tickers: list[str]) -> str:
    rows = "\n".join(
        f"<tr><td>{ticker} common stock</td><td>{ticker}</td><td>$100.00</td><td>$60.00</td></tr>"
        for ticker in tickers
    )
    return f"""
    <html>
      <body>
        <h1>Auto Callable Contingent Interest Notes Linked to the Least Performing Underlying</h1>
        <p>CUSIP: 48133ZZZ1. The notes are automatically called if each underlying is at or above its call value.</p>
        <table>
          <tr><td>Pricing Date</td><td>January 15, 2026</td></tr>
          <tr><td>Maturity Date</td><td>January 20, 2028</td></tr>
          <tr><td>Contingent Interest Rate</td><td>13.50% per annum, payable monthly</td></tr>
          <tr><td>Interest Barrier/Trigger Value</td><td>60.00% of its Initial Value</td></tr>
          <tr><td>Review Dates</td><td>Monthly review dates.</td></tr>
        </table>
        <table>
          <tr><th>Reference Stock</th><th>Ticker Symbol</th><th>Initial Value</th><th>Interest Barrier/Trigger Value</th></tr>
          {rows}
        </table>
      </body>
    </html>
    """


def _persist_note(client, *, accession_suffix: int, tickers: list[str]) -> dict:
    return assert_ok(
        client.post(
            "/structured-notes/sec-424b2/parse-preview",
            json={
                "issuer_cik": "0001665650",
                "accession_number": f"0001918704-26-{accession_suffix:06d}",
                "html": _multi_leg_html(tickers),
                "persist": True,
            },
        )
    )


def _seed_price_snapshot(service, symbols: list[str], dates: list[str]) -> None:
    rows: list[dict] = []
    for symbol in sorted(set(symbols)):
        for date in dates:
            rows.append(
                {
                    "symbol": symbol,
                    "date": date,
                    "open": 100.0,
                    "high": 101.0,
                    "low": 99.0,
                    "close": 100.0,
                    "adj_close": 100.0,
                    "volume": 1_000_000,
                }
            )
    service.market_data_repository.replace_dataset_snapshot(
        {
            "id": DATASET_PRICE_SNAPSHOT_ID,
            "kind": "DATASET",
            "name": "PIT price bars",
            "status": "READY",
            "source": "test_seed",
            "row_count": len(rows),
            "metadata": {"test_seed": "structured_note_runtime_preflight"},
        },
        price_bars=rows,
    )


def _clear_underlying_initial_values(service, note_id: str) -> None:
    service.storage.execute(
        """
        UPDATE structured_note_underlyings
        SET initial_value = NULL, strike_value = NULL
        WHERE note_id = ?
        """,
        (note_id,),
    )
    service._invalidate_structured_note_f1_static_cache(note_id)


def test_f1_static_cache_lru_eviction_logs_debug_note_id_and_bytes(monkeypatch, caplog) -> None:
    monkeypatch.setenv("GRIT_STRUCTURED_NOTE_F1_CACHE_MAX_NOTES", "2")
    monkeypatch.setenv("GRIT_STRUCTURED_NOTE_F1_CACHE_POLICY", "read_through_lru")
    client, _db_path = create_test_client(_runtime_dir("structured-note-cache-lru"))
    parsed = [
        _persist_note(client, accession_suffix=15001, tickers=["AAPL"]),
        _persist_note(client, accession_suffix=15002, tickers=["MSFT"]),
        _persist_note(client, accession_suffix=15003, tickers=["NVDA"]),
    ]

    logger_name = "grit_backtest_platform._real_service_rebuilt"
    with caplog.at_level(logging.DEBUG, logger=logger_name):
        for item in parsed:
            assert_ok(client.get(f"/structured-notes/fcn/instances/{item['note']['note_id']}/definition-bindings"))

    stats = assert_ok(client.get("/structured-notes/fcn/f1-cache-stats"))
    eviction_records = [
        record
        for record in caplog.records
        if record.name == logger_name and record.getMessage() == "structured_note_f1_cache_evicted"
    ]
    assert stats["cache_entry_count"] == 2
    assert stats["eviction_count"] == 1
    assert eviction_records
    assert getattr(eviction_records[0], "note_id") == parsed[0]["note"]["note_id"]
    assert getattr(eviction_records[0], "approx_memory_bytes") > 0


def test_replay_preflight_reports_strict_slot_histogram_for_long_tail_notes() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-slot-preflight"))
    ticker_sets = [
        ["AAPL"],
        ["AAPL", "MSFT", "NVDA"],
        ["AAPL", "MSFT", "NVDA"],
        ["AAPL", "MSFT", "NVDA", "TSLA", "AMD"],
        ["AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META", "GOOG", "AMZN"],
    ]
    parsed = [
        _persist_note(client, accession_suffix=15100 + index, tickers=tickers)
        for index, tickers in enumerate(ticker_sets)
    ]
    all_symbols = [ticker for tickers in ticker_sets for ticker in tickers]
    _seed_price_snapshot(client.app.state.service, all_symbols, ["2026-01-30", "2026-02-27"])

    direct = client.app.state.service.preflight_structured_note_fcn_replay(
        {
            "note_ids": [item["note"]["note_id"] for item in parsed],
            "sample_limit": 10,
            "max_notes": 10,
            "start_date": "2026-01-01",
            "end_date": "2026-02-28",
        }
    )
    fetched = assert_ok(client.get(f"/structured-notes/fcn/replay/preflight-runs/{direct['run_id']}"))

    assert direct["status"] == "OK"
    assert direct["slot_count_histogram"] == {1: 1, 3: 2, 5: 1, 8: 1}
    assert direct["max_underlying_count"] == 8
    assert fetched["slot_count_histogram"] == {"1": 1, "3": 2, "5": 1, "8": 1}
    assert fetched["summary"]["preflight_only"] is True


def test_replay_preflight_blocks_missing_prices_without_formal_replay_run() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-preflight-missing-price"))
    parsed = _persist_note(client, accession_suffix=15201, tickers=["AAPL", "MSFT", "NVDA"])
    _seed_price_snapshot(client.app.state.service, ["AAPL"], ["2026-01-30", "2026-02-27"])

    response = assert_ok(
        client.post(
            "/structured-notes/fcn/replay/preflight",
            json={
                "note_ids": [parsed["note"]["note_id"]],
                "start_date": "2026-01-01",
                "end_date": "2026-02-28",
            },
        )
    )

    assert response["status"] == "DATA_SOURCE_BLOCKED"
    assert response["data_source_blocked_count"] == 1
    assert set(response["note_results"][0]["missing_symbols"]) == {"MSFT", "NVDA"}
    replay_rows = client.app.state.service.storage.fetch_all("SELECT * FROM structured_note_replay_runs")
    assert replay_rows == []


def test_replay_preflight_stops_on_memory_guardrail(monkeypatch) -> None:
    monkeypatch.setenv("GRIT_STRUCTURED_NOTE_F1_CACHE_WARN_MB", "0.000001")
    client, _db_path = create_test_client(_runtime_dir("structured-note-preflight-memory"))
    parsed = _persist_note(client, accession_suffix=15301, tickers=["AAPL"])
    _seed_price_snapshot(client.app.state.service, ["AAPL"], ["2026-01-30"])

    response = assert_ok(
        client.post(
            "/structured-notes/fcn/replay/preflight",
            json={
                "note_ids": [parsed["note"]["note_id"]],
                "start_date": "2026-01-01",
                "end_date": "2026-01-31",
            },
        )
    )

    assert response["status"] == "MEMORY_GUARDRAIL_BLOCKED"
    assert "f1_static_cache_memory_guardrail_exceeded" in response["summary"]["warnings"]


def test_replay_preflight_sandbox_initial_value_proxy_is_explicit_and_audited() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-preflight-initial-proxy"))
    parsed = _persist_note(client, accession_suffix=15401, tickers=["AAPL", "MSFT"])
    note_id = parsed["note"]["note_id"]
    service = client.app.state.service
    _clear_underlying_initial_values(service, note_id)
    _seed_price_snapshot(service, ["AAPL", "MSFT"], ["2026-01-30", "2026-02-27"])

    blocked = assert_ok(
        client.post(
            "/structured-notes/fcn/replay/preflight",
            json={
                "note_ids": [note_id],
                "start_date": "2026-01-01",
                "end_date": "2026-02-28",
            },
        )
    )
    assert blocked["status"] == "DATA_SOURCE_BLOCKED"
    assert blocked["note_results"][0]["blocker_code"] == "missing_initial_value"
    assert set(blocked["note_results"][0]["missing_initial_value_symbols"]) == {"AAPL", "MSFT"}
    assert blocked["note_results"][0]["initial_value_proxy_count"] == 0

    proxied = assert_ok(
        client.post(
            "/structured-notes/fcn/replay/preflight",
            json={
                "note_ids": [note_id],
                "start_date": "2026-01-01",
                "end_date": "2026-02-28",
                "initial_value_proxy_mode": "SANDBOX_ONLY_FIRST_PRICE",
            },
        )
    )

    assert proxied["status"] == "WARN"
    assert proxied["data_source_blocked_count"] == 0
    assert proxied["summary"]["preflight_only"] is True
    assert proxied["summary"]["sandbox_initial_value_proxy_used"] is True
    assert proxied["summary"]["initial_value_proxy_count"] == 2
    assert "SANDBOX_ONLY_INITIAL_VALUE_PROXY_USED" in proxied["summary"]["warnings"]
    note_result = proxied["note_results"][0]
    assert note_result["status"] == "OK"
    assert note_result["blocker_code"] is None
    assert note_result["initial_value_proxy_mode"] == "SANDBOX_ONLY_FIRST_PRICE"
    assert note_result["initial_value_proxy_count"] == 2
    assert set(note_result["initial_value_proxy_symbols"]) == {"AAPL", "MSFT"}
    assert {item["source"] for item in note_result["initial_value_proxy_evidence"]} == {
        "dataset_price_bars.adj_close"
    }
    underlyings = service.storage.fetch_all(
        "SELECT ticker, initial_value, strike_value FROM structured_note_underlyings WHERE note_id = ?",
        (note_id,),
    )
    assert all(row["initial_value"] is None and row["strike_value"] is None for row in underlyings)
    replay_rows = service.storage.fetch_all("SELECT * FROM structured_note_replay_runs")
    assert replay_rows == []


def test_replay_preflight_uses_parser_initial_values_without_sandbox_proxy() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-preflight-parser-initial-values"))
    parsed = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/parse-preview",
            json={
                "issuer_cik": "0001665650",
                "accession_number": "0001918704-26-014078",
                "html": JPM_PRICING_SUPPLEMENT_INITIAL_VALUES_HTML,
                "persist": True,
            },
        )
    )
    service = client.app.state.service
    _seed_price_snapshot(service, ["RTY", "SPX", "KRE"], ["2026-01-30", "2026-02-27"])

    response = assert_ok(
        client.post(
            "/structured-notes/fcn/replay/preflight",
            json={
                "note_ids": [parsed["note"]["note_id"]],
                "start_date": "2026-01-01",
                "end_date": "2026-02-28",
            },
        )
    )

    assert response["status"] == "OK"
    assert response["summary"]["initial_value_proxy_count"] == 0
    assert response["summary"]["sandbox_initial_value_proxy_used"] is False
    assert "SANDBOX_ONLY_INITIAL_VALUE_PROXY_USED" not in response["summary"]["warnings"]
    assert response["data_source_blocked_count"] == 0
    assert response["note_results"][0]["initial_value_proxy_count"] == 0

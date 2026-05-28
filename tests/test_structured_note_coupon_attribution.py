from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest

from grit_backtest_platform.market_data_repository import DATASET_PRICE_SNAPSHOT_ID
from tests.api_test_support import assert_ok, create_test_client
from tests.test_sec_424b2_parser import JPM_424B2_HTML


def _runtime_dir(name: str) -> Path:
    path = Path(".tmp") / "pytest-runtime" / f"{name}-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _seed_price_snapshot(service, rows: list[dict]) -> None:
    service.market_data_repository.replace_dataset_snapshot(
        {
            "id": DATASET_PRICE_SNAPSHOT_ID,
            "kind": "DATASET",
            "name": "PIT price bars",
            "status": "READY",
            "source": "test_seed",
            "row_count": len(rows),
            "metadata": {"test_seed": "structured_note_attribution"},
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


def test_fcn_coupon_attribution_computes_cumulative_coupons_and_net_benefit() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-attribution"))
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

    attribution = assert_ok(client.get(f"/structured-notes/fcn/replay-runs/{replay['run_id']}/attribution"))

    assert attribution["status"] == "OK"
    assert attribution["summary"]["advisory_only"] is True
    assert attribution["points"][0]["cumulative_coupons"] == pytest.approx(0.135 / 12)
    assert attribution["points"][-1]["drawdown_loss_proxy"] == 0.5
    assert attribution["points"][-1]["net_benefit"] == pytest.approx((0.135 / 12 * 2) - 0.5)
    assert attribution["points"][-1]["status"] == "NEGATIVE_CONVEXITY_ACTIVE"


def test_fcn_coupon_attribution_keeps_missing_price_path_blocked() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-attribution-blocked"))
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
    dates = ["2026-01-30", "2026-02-27"]
    _seed_price_snapshot(
        client.app.state.service,
        _price_rows(["NVDA"], dates, {"NVDA": [100.0, 90.0]}),
    )
    replay = assert_ok(
        client.post(
            "/structured-notes/fcn/replay",
            json={
                "parse_run_id": parsed["parse_run"]["run_id"],
                "start_date": "2026-01-01",
                "end_date": "2026-02-28",
            },
        )
    )

    attribution = assert_ok(client.get(f"/structured-notes/fcn/replay-runs/{replay['run_id']}/attribution"))

    assert attribution["status"] == "DATA_SOURCE_BLOCKED"
    assert attribution["summary"]["blocked_count"] == len(attribution["points"])
    assert {point["status"] for point in attribution["points"]} == {"DATA_SOURCE_BLOCKED"}

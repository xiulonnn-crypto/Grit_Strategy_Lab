from __future__ import annotations

import json
from pathlib import Path
from uuid import uuid4

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
            "metadata": {"test_seed": "structured_note_pressure"},
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


def _parse_and_replay(client, accession: str) -> dict:
    parsed = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/parse-preview",
            json={
                "issuer_cik": "0001665650",
                "accession_number": accession,
                "html": JPM_424B2_HTML,
                "persist": True,
            },
        )
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
    return {
        "accession_number": accession,
        "note_id": parsed["note"]["note_id"],
        "last_replay_run_id": replay["run_id"],
        "status": parsed["status"],
    }


def test_fcn_pilot_pressure_test_emits_advisory_beta_reduction_only(tmp_path) -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-pressure"))
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
    entries = [
        _parse_and_replay(client, f"0001918704-26-01407{index}")
        for index in range(5, 8)
    ]
    manifest_path = tmp_path / "jpm_manifest.json"
    manifest_path.write_text(
        json.dumps({"manifest_id": "pressure_manifest", "entries": entries}, ensure_ascii=False),
        encoding="utf-8",
    )

    pressure = assert_ok(
        client.post(
            "/structured-notes/fcn/pilot-pressure-test",
            json={"manifest_path": str(manifest_path)},
        )
    )

    assert pressure["risk_state"] == "REDUCE_BETA"
    assert pressure["coverage_ratio"] == 1.0
    assert pressure["notes_near_barrier_count"] == 3
    assert pressure["notes_breached_barrier_count"] == 3
    assert pressure["advisory_instructions"] == [
        {
            "action_type": "Beta_Reduction",
            "target": "QQQ",
            "mode": "ADVISORY_ONLY",
            "reason": "Pilot FCN average distance to barrier deteriorated",
            "suggested_beta_multiplier": 0.75,
            "publish_boundary": "sandbox -> quarantine -> publish",
        }
    ]


def test_fcn_pilot_pressure_test_blocks_when_replay_coverage_is_incomplete(tmp_path) -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-pressure-blocked"))
    manifest_path = tmp_path / "blocked_manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "manifest_id": "blocked_manifest",
                "entries": [{"accession_number": f"missing-{index}", "note_id": f"note-{index}"} for index in range(10)],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    pressure = assert_ok(
        client.post(
            "/structured-notes/fcn/pilot-pressure-test",
            json={"manifest_path": str(manifest_path)},
        )
    )

    assert pressure["risk_state"] == "DATA_SOURCE_BLOCKED"
    assert pressure["coverage_ratio"] == 0.0
    assert pressure["blocked_note_count"] == 10
    assert pressure["advisory_instructions"] == []

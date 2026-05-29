from __future__ import annotations

from grit_backtest_platform.market_data_repository import DATASET_PRICE_SNAPSHOT_ID
from tests.api_test_support import assert_ok, create_test_client
from tests.test_structured_note_runtime_preflight import _persist_note, _runtime_dir, _seed_price_snapshot


def test_clean_preflight_without_initial_value_proxy_leaves_no_formal_replay_run() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-clean-preflight"))
    parsed = _persist_note(client, accession_suffix=16101, tickers=["AAPL", "MSFT", "NVDA"])
    service = client.app.state.service
    _seed_price_snapshot(service, ["AAPL", "MSFT", "NVDA"], ["2026-01-30", "2026-02-27"])

    response = assert_ok(
        client.post(
            "/structured-notes/fcn/replay/preflight",
            json={
                "note_ids": [parsed["note"]["note_id"]],
                "start_date": "2026-01-01",
                "end_date": "2026-02-28",
                "replay_mode": "sandbox",
            },
        )
    )

    assert response["status"] == "OK"
    assert response["summary"]["initial_value_proxy_count"] == 0
    assert response["summary"]["sandbox_initial_value_proxy_used"] is False
    assert "SANDBOX_ONLY_INITIAL_VALUE_PROXY_USED" not in response["summary"]["warnings"]
    assert service.storage.fetch_all("SELECT * FROM structured_note_replay_runs") == []


def test_shadow_replay_batch_persists_points_and_attribution_summary() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-shadow-replay-batch"))
    first = _persist_note(client, accession_suffix=16201, tickers=["AAPL"])
    second = _persist_note(client, accession_suffix=16202, tickers=["MSFT", "NVDA", "TSLA"])
    service = client.app.state.service
    _seed_price_snapshot(service, ["AAPL", "MSFT", "NVDA", "TSLA"], ["2026-01-30", "2026-02-27"])

    batch = assert_ok(
        client.post(
            "/structured-notes/fcn/replay/batch",
            json={
                "note_ids": [first["note"]["note_id"], second["note"]["note_id"]],
                "dataset_snapshot_id": DATASET_PRICE_SNAPSHOT_ID,
                "start_date": "2026-01-01",
                "end_date": "2026-02-28",
                "replay_mode": "sandbox",
            },
        )
    )

    assert batch["status"] == "OK"
    assert batch["note_count"] == 2
    assert batch["replay_run_count"] == 2
    assert batch["replay_point_count"] == 4
    assert batch["summary"]["shadow_replay"] is True
    assert batch["summary"]["formal_factor_factory_write"] is False
    point_rows = service.storage.fetch_all("SELECT * FROM structured_note_replay_points")
    assert len(point_rows) == 4

    fetched = assert_ok(client.get(f"/structured-notes/fcn/replay-batches/{batch['batch_id']}"))
    assert fetched["run_ids"] == batch["run_ids"]
    attribution = assert_ok(
        client.get(f"/structured-notes/fcn/replay-batches/{batch['batch_id']}/attribution-summary")
    )
    assert attribution["status"] == "OK"
    assert attribution["replay_run_count"] == 2
    assert attribution["latest_net_benefit_avg"] is not None


def test_replay_run_alias_delegates_to_canonical_persistent_replay() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-replay-run-alias"))
    parsed = _persist_note(client, accession_suffix=16301, tickers=["AAPL"])
    service = client.app.state.service
    _seed_price_snapshot(service, ["AAPL"], ["2026-01-30"])

    replay = assert_ok(
        client.post(
            "/structured-notes/fcn/replay/run",
            json={
                "parse_run_id": parsed["parse_run"]["run_id"],
                "start_date": "2026-01-01",
                "end_date": "2026-01-31",
                "replay_mode": "sandbox",
            },
        )
    )

    assert replay["status"] == "OK"
    assert service.storage.fetch_one(
        "SELECT run_id FROM structured_note_replay_runs WHERE run_id = ?",
        (replay["run_id"],),
    )


def test_sec_424b2_ingestion_job_preview_and_create_are_dry_run_audit_contracts() -> None:
    client, _db_path = create_test_client(_runtime_dir("sec-424b2-ingestion-preview"))
    parsed = _persist_note(client, accession_suffix=16401, tickers=["AAPL"])
    existing_accession = parsed["parse_run"]["accession_number"]
    new_source_url = "https://www.sec.gov/Archives/edgar/data/1665650/00019187042616402/form424b2.htm"
    payload = {
        "issuer_cik": "0001665650",
        "accessions": [
            {
                "accession_number": existing_accession,
                "source_url": parsed["parse_run"]["source_url"] or new_source_url,
                "primary_document": "form424b2.htm",
            },
            {
                "accession_number": "0001918704-26-016402",
                "source_url": new_source_url,
                "primary_document": "form424b2.htm",
            },
        ],
        "max_filings": 2,
        "rate_limit_rps": 5,
    }

    preview = assert_ok(client.post("/structured-notes/sec-424b2/ingestion-jobs/preview", json=payload))
    assert preview["status"] == "DRY_RUN_READY"
    assert preview["summary"]["skipped_existing_count"] == 1
    assert {action["status"] for action in preview["actions"]} == {"SKIPPED_EXISTING", "WOULD_FETCH_AND_PARSE"}
    before_count = client.app.state.service.storage.fetch_one("SELECT COUNT(*) AS count FROM sec_424b2_parse_runs")

    job = assert_ok(client.post("/structured-notes/sec-424b2/ingestion-jobs", json=payload))
    fetched = assert_ok(client.get(f"/structured-notes/sec-424b2/ingestion-jobs/{job['job_id']}"))
    after_count = client.app.state.service.storage.fetch_one("SELECT COUNT(*) AS count FROM sec_424b2_parse_runs")
    assert job["status"] == "DRY_RUN_READY"
    assert fetched["summary"]["factor_factory_write"] is False
    assert after_count["count"] == before_count["count"]


def test_structured_note_factor_factory_mount_contract_is_governed_template_only() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-factor-mount-contract"))

    contract = assert_ok(client.get("/structured-notes/fcn/factor-factory-mount-contract"))

    assert contract["registration_status"] == "CONTRACT_READY"
    assert "f2_fcn_net_benefit" in contract["f2_definition_ids"]
    assert contract["dimension_schema"]["primary_dimensions"] == ["note_id", "note_date"]
    assert contract["factor_library_write"] == "BLOCKED_UNTIL_QUARANTINE_PUBLISH"
    assert contract["summary"]["quarantine_required"] is True

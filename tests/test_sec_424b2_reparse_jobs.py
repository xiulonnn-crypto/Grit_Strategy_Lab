from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from tests.api_test_support import assert_ok, create_test_client
from grit_backtest_platform.sec_edgar_provider import SecEdgarProvider
from tests.test_sec_424b2_parser import JPM_424B2_HTML, JPM_PRICING_SUPPLEMENT_INITIAL_VALUES_HTML


def _runtime_dir(name: str) -> Path:
    path = Path(".tmp") / "pytest-runtime" / f"{name}-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_sec_424b2_reparse_job_defaults_to_disabled_dry_run() -> None:
    client, _db_path = create_test_client(_runtime_dir("sec-424b2-reparse-disabled"))
    assert_ok(
        client.post(
            "/structured-notes/sec-424b2/parse-preview",
            json={
                "source_url": "https://www.sec.gov/Archives/edgar/data/19617/000191870426014078/form424b2.htm",
                "issuer_cik": "0001665650",
                "accession_number": "0001918704-26-014078",
                "html": JPM_424B2_HTML,
                "persist": True,
            },
        )
    )

    preview = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/reparse-jobs/preview",
            json={"current_parser_version": "sec_424b2_contract_skeleton_vNEXT"},
        )
    )

    assert preview["status"] == "DISABLED"
    assert preview["dry_run"] is True
    assert preview["candidate_count"] == 1
    assert preview["selected_count"] == 0
    assert preview["actions"] == []
    assert preview["summary"]["blocked_reason"] == "auto_repair_disabled"


def test_sec_424b2_reparse_job_allowlist_and_max_filings_do_not_write_parse_runs() -> None:
    client, _db_path = create_test_client(_runtime_dir("sec-424b2-reparse-enabled"))
    service = client.app.state.service
    for index in range(3):
        assert_ok(
            client.post(
                "/structured-notes/sec-424b2/parse-preview",
                json={
                    "source_url": f"https://www.sec.gov/Archives/edgar/data/19617/00019187042601407{index}/form424b2.htm",
                    "issuer_cik": "0001665650",
                    "accession_number": f"0001918704-26-01407{index}",
                    "html": JPM_424B2_HTML,
                    "persist": True,
                },
            )
        )
    before_count = len(service.storage.fetch_all("SELECT run_id FROM sec_424b2_parse_runs"))

    blocked_by_allowlist = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/reparse-jobs/preview",
            json={
                "auto_repair_enabled": True,
                "current_parser_version": "sec_424b2_contract_skeleton_vNEXT",
                "reasons_allowlist": ["HTML_CHANGED"],
                "max_filings": 10,
            },
        )
    )
    assert blocked_by_allowlist["selected_count"] == 0

    job = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/reparse-jobs",
            json={
                "auto_repair_enabled": True,
                "current_parser_version": "sec_424b2_contract_skeleton_vNEXT",
                "reasons_allowlist": ["PARSER_CHANGED"],
                "max_filings": 1,
            },
        )
    )
    after_count = len(service.storage.fetch_all("SELECT run_id FROM sec_424b2_parse_runs"))
    fetched = assert_ok(client.get(f"/structured-notes/sec-424b2/reparse-jobs/{job['job_id']}"))

    assert job["status"] == "DRY_RUN_READY"
    assert job["candidate_count"] == 3
    assert job["selected_count"] == 1
    assert job["actions"][0]["action"] == "REPARSE_DRY_RUN"
    assert job["actions"][0]["would_write_parse_run"] is False
    assert after_count == before_count
    assert fetched["job_id"] == job["job_id"]
    assert fetched["selected_count"] == 1


def test_sec_424b2_reparse_initial_value_missing_preview_and_apply(monkeypatch) -> None:
    client, _db_path = create_test_client(_runtime_dir("sec-424b2-reparse-initial-values"))
    source_url = "https://www.sec.gov/Archives/edgar/data/19617/000191870426014078/form424b2.htm"
    parsed = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/parse-preview",
            json={
                "source_url": source_url,
                "issuer_cik": "0001665650",
                "accession_number": "0001918704-26-014078",
                "html": JPM_PRICING_SUPPLEMENT_INITIAL_VALUES_HTML,
                "persist": True,
            },
        )
    )
    note_id = parsed["note"]["note_id"]
    service = client.app.state.service
    service.storage.execute(
        """
        UPDATE structured_note_underlyings
        SET initial_value = NULL, strike_value = NULL
        WHERE note_id = ?
        """,
        (note_id,),
    )
    service._invalidate_structured_note_f1_static_cache(note_id)
    before_rows = service.storage.fetch_all("SELECT run_id FROM sec_424b2_parse_runs")

    preview = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/reparse-jobs/preview",
            json={
                "auto_repair_enabled": True,
                "reasons_allowlist": ["INITIAL_VALUE_MISSING"],
                "max_filings": 10,
            },
        )
    )

    assert preview["status"] == "DRY_RUN_READY"
    assert preview["selected_count"] == 1
    assert preview["candidates"][0]["note_id"] == note_id
    assert preview["candidates"][0]["missing_initial_value_count"] == 3
    assert preview["actions"][0]["would_write_parse_run"] is False
    assert len(service.storage.fetch_all("SELECT run_id FROM sec_424b2_parse_runs")) == len(before_rows)

    monkeypatch.setattr(
        SecEdgarProvider,
        "fetch_archive_document",
        lambda self, url: JPM_PRICING_SUPPLEMENT_INITIAL_VALUES_HTML,
    )
    job = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/reparse-jobs",
            json={
                "auto_repair_enabled": True,
                "mode": "apply_append_only",
                "dry_run": False,
                "reasons_allowlist": ["INITIAL_VALUE_MISSING"],
                "max_filings": 10,
            },
        )
    )

    assert job["status"] == "APPLIED"
    assert job["dry_run"] is False
    assert job["summary"]["initial_value_missing_count"] == 3
    assert job["summary"]["initial_value_resolved_count"] == 3
    assert job["summary"]["review_required_count"] == 0
    assert job["summary"]["append_only_parse_run_count"] == 1
    assert job["summary"]["cache_invalidated_note_ids"] == [note_id]
    rows = service.storage.fetch_all(
        "SELECT ticker, initial_value, strike_value FROM structured_note_underlyings WHERE note_id = ? ORDER BY ticker",
        (note_id,),
    )
    assert {row["ticker"]: row["initial_value"] for row in rows} == {
        "KRE": 52.4,
        "RTY": 2050.25,
        "SPX": 5600.75,
    }
    anchors = service.storage.fetch_all(
        """
        SELECT field_path, table_index, row_index, column_index
        FROM structured_note_evidence_anchors
        WHERE note_id = ? AND field_path LIKE '%initial_value'
        """,
        (note_id,),
    )
    assert {row["field_path"] for row in anchors} == {
        "underlyings.KRE.initial_value",
        "underlyings.RTY.initial_value",
        "underlyings.SPX.initial_value",
    }

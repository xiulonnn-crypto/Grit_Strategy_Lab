from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from tests.api_test_support import assert_ok, create_test_client
from tests.test_sec_424b2_parser import JPM_424B2_HTML


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

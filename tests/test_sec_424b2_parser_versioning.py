from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from grit_backtest_platform.structured_notes import parse_sec_424b2_structured_note
from tests.api_test_support import assert_ok, create_test_client
from tests.test_sec_424b2_parser import JPM_424B2_HTML


def _runtime_dir(name: str) -> Path:
    path = Path(".tmp") / "pytest-runtime" / f"{name}-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_sec_424b2_parser_hashes_are_stable_for_same_html_and_rulepack() -> None:
    first = parse_sec_424b2_structured_note(
        JPM_424B2_HTML,
        source_url="https://www.sec.gov/Archives/edgar/data/19617/000191870426014078/form424b2.htm",
        issuer_cik="0001665650",
        accession_number="0001918704-26-014078",
    )
    second = parse_sec_424b2_structured_note(
        JPM_424B2_HTML,
        source_url="https://www.sec.gov/Archives/edgar/data/19617/000191870426014078/form424b2.htm",
        issuer_cik="0001665650",
        accession_number="0001918704-26-014078",
    )

    for field in (
        "raw_html_sha256",
        "normalized_text_hash",
        "table_signature_hash",
        "parser_rule_hash",
        "parse_result_hash",
    ):
        assert first["parse_run"][field]
        assert first["parse_run"][field] == second["parse_run"][field]


def test_sec_424b2_reparse_candidates_track_parser_rule_and_html_drift() -> None:
    client, _db_path = create_test_client(_runtime_dir("sec-424b2-versioning"))
    first = assert_ok(
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
    drifted = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/parse-preview",
            json={
                "source_url": "https://www.sec.gov/Archives/edgar/data/19617/000191870426014078/form424b2.htm",
                "issuer_cik": "0001665650",
                "accession_number": "0001918704-26-014078",
                "html": JPM_424B2_HTML.replace("</body>", "<p>SEC layout drift marker</p></body>"),
                "persist": True,
            },
        )
    )

    assert first["parse_run"]["run_id"] != drifted["parse_run"]["run_id"]
    assert first["parse_run"]["raw_html_sha256"] != drifted["parse_run"]["raw_html_sha256"]

    html_candidates = assert_ok(client.get("/structured-notes/sec-424b2/reparse-candidates"))
    html_reasons = {
        reason
        for candidate in html_candidates["candidates"]
        for reason in candidate["reasons"]
    }
    assert "HTML_CHANGED" in html_reasons

    parser_candidates = assert_ok(
        client.get(
            "/structured-notes/sec-424b2/reparse-candidates",
            params={"current_parser_version": "sec_424b2_contract_skeleton_vNEXT", "current_rule_hash": "new-rule-hash"},
        )
    )
    parser_reasons = {
        reason
        for candidate in parser_candidates["candidates"]
        for reason in candidate["reasons"]
    }
    assert {"PARSER_CHANGED", "RULEPACK_CHANGED"} <= parser_reasons

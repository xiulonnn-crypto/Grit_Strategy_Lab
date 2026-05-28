from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from tests.api_test_support import assert_ok, create_test_client
from tests.test_sec_424b2_parser import JPM_424B2_HTML


def _runtime_dir(name: str) -> Path:
    path = Path(".tmp") / "pytest-runtime" / f"{name}-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def test_sec_424b2_parse_preview_persists_auditable_f1_f2_contract() -> None:
    client, _db_path = create_test_client(_runtime_dir("sec-424b2-contract"))

    response = assert_ok(
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

    assert response["status"] == "PARSED"
    assert response["llm_used"] is False
    assert response["note"]["note_id"].startswith("note_1665650_")
    assert response["note"]["factor_id"] == "f1_fcn_note_terms"
    assert response["note"]["coupon_rate_annual"] == 0.135
    assert response["note"]["barrier_percentage"] == 0.6
    assert response["note"]["underlying_count"] == 3
    assert response["note"]["underlying_tickers"] == ["NVDA", "MSFT", "TSLA"]
    assert response["f2_contract"]["output_dimension"] == "note_date"
    assert response["f2_contract"]["definition_version"] == "sec_424b2_fcn_definitions_v1"
    assert response["f2_contract"]["source_factor_ids"][0].startswith("f1_fcn_")
    assert "f1_fcn_underlying_count" in response["f2_contract"]["source_factor_ids"]
    assert response["f2_contract"]["underlying_count"] == 3
    expression_names = {item["name"] for item in response["f2_contract"]["expressions"]}
    assert {
        "FCN_Worst_Performance",
        "FCN_Coupon_Eligibility",
        "FCN_Coupon_Signal",
        "FCN_Autocall_Trigger",
        "FCN_Distance_To_Barrier",
        "FCN_Memory_Coupon_State",
    } <= expression_names
    expression_ids = {item["factor_id"] for item in response["f2_contract"]["expressions"]}
    assert "f2_fcn_worst_performance" in expression_ids
    assert not any(response["note"]["note_id"] in factor_id for factor_id in expression_ids)

    persisted = assert_ok(client.get(f"/structured-notes/sec-424b2/parse-runs/{response['parse_run']['run_id']}"))
    assert persisted["parse_run"]["raw_html_sha256"] == response["parse_run"]["raw_html_sha256"]
    assert persisted["note"]["note_id"] == response["note"]["note_id"]
    assert [item["ticker"] for item in persisted["underlyings"]] == ["NVDA", "MSFT", "TSLA"]
    assert persisted["f2_contract"]["publish_boundary"] == "sandbox -> quarantine -> publish"


def test_sec_424b2_parse_preview_marks_low_confidence_contract_review_required() -> None:
    client, _db_path = create_test_client(_runtime_dir("sec-424b2-review-required"))
    html = """
    <html><body>
      <h1>Notes linked to an unclear basket</h1>
      <p>This filing mentions a coupon but omits underlying tickers and barrier evidence.</p>
      <table><tr><td>Interest Rate</td><td>7.00% per annum</td></tr></table>
    </body></html>
    """

    response = assert_ok(
        client.post(
            "/structured-notes/sec-424b2/parse-preview",
            json={"issuer_cik": "0001665650", "html": html, "persist": False},
        )
    )

    assert response["status"] == "REVIEW_REQUIRED"
    assert "underlying_tickers_missing" in response["warnings"]
    assert "barrier_terms_missing" in response["warnings"]
    assert response["llm_used"] is False
    assert response["f2_contract"]["production_llm_policy"] == "NO_LLM_PROD"

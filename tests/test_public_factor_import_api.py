from __future__ import annotations

import csv
import hashlib
import io
import json
import zipfile

from grit_backtest_platform.external_factor_imports import (
    PUBLIC_FACTOR_IMPORT_INITIAL_STATUS,
    analyze_public_factor_upload_text,
    build_public_factor_csv_template,
    build_public_factor_import_job_projection,
    build_public_factor_xlsx_template,
    list_public_factor_source_registry,
)
from tests.api_test_support import assert_ok, create_test_client


def test_public_factor_source_registry_marks_intake_policies() -> None:
    registry = {item["source_id"]: item for item in list_public_factor_source_registry()}

    assert registry["fama_french"]["datasets"][0]["frequency"] == "daily"
    assert registry["fama_french"]["datasets"][1]["frequency"] == "monthly"
    assert registry["aqr"]["license_mode"] == "license/manual_upload"
    assert registry["msci_facs"]["status"] == "reference_only"
    assert registry["portfolio_visualizer"]["intake_policy"] == "reference_only_no_import"


def test_public_factor_csv_template_is_parseable() -> None:
    artifact = build_public_factor_csv_template()

    assert artifact.filename.endswith(".csv")
    assert artifact.media_type == "text/csv"
    rows = list(csv.DictReader(io.StringIO(artifact.content.decode("utf-8"))))
    assert rows[0]["factor_id"] == "ff_mkt_rf"
    assert rows[0]["source_dataset"] == "fama_french_us_research_factors_monthly"


def test_public_factor_xlsx_template_is_minimal_openxml_workbook() -> None:
    artifact = build_public_factor_xlsx_template()

    assert artifact.filename.endswith(".xlsx")
    with zipfile.ZipFile(io.BytesIO(artifact.content), "r") as workbook:
        names = set(workbook.namelist())
        sheet_xml = workbook.read("xl/worksheets/sheet1.xml").decode("utf-8")

    assert "[Content_Types].xml" in names
    assert "xl/workbook.xml" in names
    assert "factor_id" in sheet_xml
    assert "ff_mkt_rf" in sheet_xml


def test_analyze_public_factor_csv_upload_suggests_mapping_and_hash() -> None:
    text = "Date,Factor,Ret,Ticker\n2026-01-31,MKT_RF,0.012,AAPL\n"

    analysis = analyze_public_factor_upload_text(text, filename="factors.csv")

    assert analysis["format"] == "csv"
    assert analysis["sha256"] == hashlib.sha256(text.encode("utf-8")).hexdigest()
    assert analysis["row_count"] == 1
    assert analysis["columns"] == ["Date", "Factor", "Ret", "Ticker"]
    assert analysis["sample_rows"][0]["Ticker"] == "AAPL"
    assert analysis["field_mapping_suggestions"]["date"] == "Date"
    assert analysis["field_mapping_suggestions"]["factor_id"] == "Factor"
    assert analysis["field_mapping_suggestions"]["value"] == "Ret"
    assert analysis["precheck"]["can_publish"] is False
    assert analysis["precheck"]["review_gate"] == "PENDING_REVIEW"


def test_analyze_public_factor_json_upload_accepts_rows_wrapper() -> None:
    payload = {
        "rows": [
            {
                "as_of": "2026-01-31",
                "factor_code": "quality",
                "score": 0.72,
            }
        ]
    }
    text = json.dumps(payload)

    analysis = analyze_public_factor_upload_text(text, filename="factors.json")

    assert analysis["format"] == "json"
    assert analysis["columns"] == ["as_of", "factor_code", "score"]
    assert analysis["field_mapping_suggestions"]["date"] == "as_of"
    assert analysis["field_mapping_suggestions"]["factor_id"] == "factor_code"
    assert analysis["field_mapping_suggestions"]["value"] == "score"


def test_import_job_projection_is_review_gated_and_has_submit_review_flow() -> None:
    projection = build_public_factor_import_job_projection(
        job_id="job-public-factor-1",
        source_id="Fama French",
        filename="factors.csv",
        sha256="a" * 64,
        row_count=10,
        columns=["date", "factor_id", "value"],
    )

    assert projection["status"] == PUBLIC_FACTOR_IMPORT_INITIAL_STATUS
    assert projection["can_publish"] is False
    assert projection["direct_publish_allowed"] is False
    assert projection["flow"] == [
        "import_file",
        "create_precheck",
        "semantic_mapping",
        "submit_review",
    ]
    assert projection["next_step"] == "submit_review"
    assert projection["semantic_mapping"]["status"] == "MAPPING_READY"


def test_factor_sources_registry_api_exposes_review_gated_sources(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)

    payload = assert_ok(client.get("/factor-sources/registry"))

    assert payload["review_boundary"] == "D2_QUARANTINE_REVIEW"
    sources = {source["id"]: source for source in payload["sources"]}
    assert sources["fama_french"]["access_policy"] == "PUBLIC_DOWNLOAD"
    assert sources["aqr"]["access_policy"] == "LICENSE_REQUIRED"
    assert sources["msci_facs"]["access_policy"] == "REFERENCE_ONLY"


def test_auto_download_precheck_builds_source_manifest_and_can_submit_review(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)

    job = assert_ok(
        client.post(
            "/factor-sources/import-jobs",
            json={
                "source_id": "fama_french",
                "dataset_key": "fama_french_us_research_factors_daily",
                "import_mode": "AUTO_DOWNLOAD",
                "frequency": "DAILY",
            },
        )
    )

    assert job["status"] == "REVIEW_GATED"
    assert job["review_status"] == "READY_FOR_REVIEW"
    assert job["manifest"]["parsing_status"] == "SOURCE_MANIFEST_READY"
    assert job["manifest"]["columns"][:3] == ["date", "factor_id", "factor_name"]
    assert {row["target_field"] for row in job["mapping_rows"] if row["required"]} == {
        "date",
        "factor_id",
        "value",
    }
    assert job["next_actions"] == ["inspect_manifest", "submit_review"]

    submitted = assert_ok(client.post(f"/factor-sources/import-jobs/{job['id']}/submit-review"))
    assert submitted["status"] == "REVIEW_SUBMITTED"
    assert submitted["review_status"] == "SUBMITTED"


def test_factor_source_template_api_serves_xlsx_by_extension(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)

    response = client.get("/factor-sources/templates/source_template.xlsx")

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    with zipfile.ZipFile(io.BytesIO(response.content), "r") as workbook:
        assert "xl/worksheets/sheet1.xml" in set(workbook.namelist())


def test_factor_source_local_file_job_mapping_and_review_api(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    upload = assert_ok(
        client.post(
            "/factor-sources/local-files",
            json={
                "source_id": "fama_french",
                "dataset_key": "fama_french_us_research_factors_daily",
                "filename": "ff.csv",
                "content_text": "date,factor_id,value\n2026-01-31,HML,0.02\n",
                "content_type": "text/csv",
            },
        )
    )

    job = assert_ok(
        client.post(
            "/factor-sources/import-jobs",
            json={
                "source_id": "fama_french",
                "dataset_key": "fama_french_us_research_factors_daily",
                "import_mode": "LOCAL_FILE",
                "file_id": upload["file_id"],
                "frequency": "DAILY",
            },
        )
    )

    assert job["status"] == "REVIEW_GATED"
    assert job["review_status"] == "READY_FOR_REVIEW"
    assert job["manifest"]["row_count"] == 1
    assert job["governance_gate"] == "REVIEW_BEFORE_QUARANTINE"

    saved = assert_ok(client.get(f"/factor-sources/import-jobs/{job['id']}"))
    assert saved["id"] == job["id"]
    submitted = assert_ok(client.post(f"/factor-sources/import-jobs/{job['id']}/submit-review"))
    assert submitted["status"] == "REVIEW_SUBMITTED"
    assert submitted["review_status"] == "SUBMITTED"

from __future__ import annotations

import csv
import hashlib
import io
import json
import zipfile

from grit_backtest_platform.external_factor_imports import (
    PUBLIC_FACTOR_IMPORT_INITIAL_STATUS,
    analyze_public_factor_upload_text,
    analyze_vibe_alpha_zoo_manifest_text,
    build_public_factor_csv_template,
    build_public_factor_import_job_projection,
    build_public_factor_xlsx_template,
    normalize_aqr_dataset_xlsx,
    list_public_factor_source_registry,
    normalize_fama_french_dataset_zip,
    _build_minimal_xlsx,
)
from grit_backtest_platform.factor_research import external_factor_import_display_projection_v1
from grit_backtest_platform.storage import dumps
from tests.api_test_support import assert_ok, create_test_client


FAMA_FRENCH_SAMPLE = """This file was created by CMPT_ME_BEME_OP_INV_RETS_DAILY using the 202602 CRSP database.
,Mkt-RF,SMB,HML,RMW,CMA,RF
20260102,0.10,0.02,-0.03,0.04,0.01,0.02
20260105,-0.05,0.01,0.04,0.03,-0.02,0.02
20260106,0.08,-0.01,0.02,0.01,0.03,0.02

Annual Factors: January-December
"""

VIBE_ALPHA_ZOO_SAMPLE = """zoo,alpha_id,formula,rank_ic,bench_classification,theme
qlib158,alpha_001,"Rank(Return(Close, 5))",0.041,alive,momentum
alpha101,alpha_002,"Rank(Return(Open, 10))",-0.036,reversed,reversal
gtja191,alpha_bad,"__import__('os').system('dir')",0.080,alive,unsafe
"""


def _fama_french_zip_bytes(text: str = FAMA_FRENCH_SAMPLE) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("F-F_Research_Data_5_Factors_2x3_daily.csv", text)
    return buffer.getvalue()


def _install_fama_french_download_fixture(client) -> None:
    normalized_csv = normalize_fama_french_dataset_zip(
        _fama_french_zip_bytes(),
        dataset_key="fama_french_us_research_factors_daily",
    )
    service = client.app.state.service._factor_research_service()

    def _fixture_download(**_kwargs):
        return {
            "filename": "fama_french_us_research_factors_daily.csv",
            "content_text": normalized_csv,
            "content_type": "text/csv",
            "download_url": "https://example.test/fama-french.zip",
            "source_archive_sha256": hashlib.sha256(_fama_french_zip_bytes()).hexdigest(),
            "dataset_name": "US research factors daily",
        }

    service._external_auto_download_file_payload = _fixture_download


def _aqr_qmj_xlsx_bytes() -> bytes:
    return _build_minimal_xlsx(
        [
            ["AQR Capital Management, LLC - Quality Minus Junk: Factors, Daily"],
            [""],
            ["DATE", "USA", "Global Ex USA"],
            ["03/29/2026", "0.01", ""],
            ["03/30/2026", "-0.02", "0.03"],
        ],
        sheet_name="QMJ Factors",
    )


def _install_aqr_download_fixture(client) -> None:
    service = client.app.state.service._factor_research_service()
    workbook_bytes = _aqr_qmj_xlsx_bytes()

    def _fixture_download(*, source, dataset, dataset_key):
        normalized_csv = normalize_aqr_dataset_xlsx(workbook_bytes, dataset_key=dataset_key)
        return {
            "filename": "aqr_public_style_factors.csv",
            "content_text": normalized_csv,
            "content_type": "text/csv",
            "download_url": "https://www.aqr.com/-/media/AQR/Documents/Insights/Data-Sets/Quality-Minus-Junk-Factors-Daily.xlsx",
            "source_archive_sha256": hashlib.sha256(workbook_bytes).hexdigest(),
            "dataset_name": str(dataset.get("label") or dataset_key),
        }

    service._external_auto_download_file_payload = _fixture_download


def _insert_completed_factory_run(service, artifact_dir) -> str:
    now = "2099-01-01T00:00:00Z"
    mining_job_id = "mine_op_public_import_publishable_control"
    artifact_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = artifact_dir / "formula-manifest.json"
    ledger_path = artifact_dir / "refined-f2-candidates.json"
    manifest_payload = {
        "job_id": mining_job_id,
        "source_job_id": mining_job_id,
        "formula_count": 1,
        "refined_count": 1,
        "hash": "public-import-publishable-control",
        "created_at": now,
    }
    ledger_payload = {
        "job_id": mining_job_id,
        "source_job_id": mining_job_id,
        "formula_count": 1,
        "refined_count": 1,
        "candidate_count": 1,
        "hash": "public-import-publishable-control",
        "created_at": now,
        "candidates": [],
    }
    manifest_path.write_text(json.dumps(manifest_payload, ensure_ascii=False), encoding="utf-8")
    ledger_path.write_text(json.dumps(ledger_payload, ensure_ascii=False), encoding="utf-8")
    operator_engine = {
        "backend": "pandas_bottleneck",
        "deduped_formula_count": 1,
        "generated_formula_count": 1,
        "raw_f2_batch_delivered_count": 1,
        "refined_f2_batch_delivered_count": 1,
        "top_preview_count": 0,
        "artifact_refs": {
            "formula_manifest": str(manifest_path),
            "refined_f2_candidate_ledger": str(ledger_path),
        },
    }
    service.storage.insert_json_row(
        "factor_mining_jobs",
        {
            "id": mining_job_id,
            "status": "COMPLETED",
            "request_json": dumps({"operator_engine": operator_engine}),
            "progress_json": dumps({"current": 1, "total": 1}),
            "summary_json": dumps({"generation_mode": "OPERATOR_ENGINE", "operator_engine": operator_engine}),
            "top_candidates_json": dumps([]),
            "failed_samples_json": dumps([]),
            "created_at": now,
            "updated_at": now,
            "completed_at": now,
            "error_message": None,
        },
    )
    service.storage.insert_json_row(
        "factor_factory_runs",
        {
            "id": "ffr_public_import_publishable_control",
            "profile_id": "default",
            "run_date": "2099-01-01",
            "trigger": "MANUAL",
            "status": "COMPLETED",
            "request_json": dumps({"generation_mode": "OPERATOR_ENGINE"}),
            "gate_policy_json": dumps({"pit_gate_mode": "DIAGNOSTIC_ONLY"}),
            "config_signature": "public-import-publishable-control",
            "mining_job_id": mining_job_id,
            "summary_json": dumps({"operator_engine": operator_engine, "mining_job_id": mining_job_id}),
            "started_at": now,
            "completed_at": now,
            "created_at": now,
            "updated_at": now,
            "error_message": None,
        },
    )
    return mining_job_id


def test_public_factor_source_registry_marks_intake_policies() -> None:
    registry = {item["source_id"]: item for item in list_public_factor_source_registry()}

    assert registry["fama_french"]["datasets"][0]["frequency"] == "daily"
    assert registry["fama_french"]["datasets"][1]["frequency"] == "monthly"
    assert registry["aqr"]["license_mode"] == "public_research/license_required"
    assert registry["vibe_alpha_zoo"]["intake_policy"] == "catalog_manifest_raw_f2_only"
    assert registry["vibe_alpha_zoo"]["datasets"][0]["dataset_id"] == "vibe_qlib158"
    assert "reviewed_import" in registry["aqr"]["datasets"][0]["allowed_intake_modes"]
    assert registry["msci_facs"]["status"] == "reference_only"
    assert registry["portfolio_visualizer"]["intake_policy"] == "reference_only_no_import"


def test_vibe_alpha_zoo_manifest_scans_ast_and_bench_classification() -> None:
    analysis = analyze_vibe_alpha_zoo_manifest_text(
        VIBE_ALPHA_ZOO_SAMPLE,
        filename="vibe.csv",
        dataset_key="vibe_qlib158",
    )
    catalog = analysis["catalog_manifest"]
    bench = analysis["bench_summary"]

    assert analysis["row_count"] == 3
    assert catalog["formula_count"] == 3
    assert catalog["supported_formula_count"] == 2
    assert catalog["blocked_formula_count"] == 1
    assert catalog["ast_scan"]["passed_count"] == 2
    assert catalog["ast_scan"]["blocked_count"] == 1
    assert len(catalog["normalized_formulas"]) == 3
    assert bench["alive_count"] == 2
    assert bench["reversed_count"] == 1
    assert analysis["precheck"]["direct_publish_allowed"] is False


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


def test_fama_french_zip_parser_materializes_public_template_rows() -> None:
    csv_text = normalize_fama_french_dataset_zip(
        _fama_french_zip_bytes(),
        dataset_key="fama_french_us_research_factors_daily",
    )

    rows = list(csv.DictReader(io.StringIO(csv_text)))

    assert rows[0]["date"] == "2026-01-02"
    assert rows[0]["factor_id"] == "ff_mkt_rf"
    assert rows[0]["factor_name"] == "Market excess return"
    assert rows[0]["value"] == "0.001"
    assert rows[0]["source_dataset"] == "fama_french_us_research_factors_daily"
    assert len(rows) == 18


def test_aqr_qmj_xlsx_parser_materializes_daily_qmj_rows() -> None:
    csv_text = normalize_aqr_dataset_xlsx(
        _aqr_qmj_xlsx_bytes(),
        dataset_key="aqr_public_style_factors",
    )

    rows = list(csv.DictReader(io.StringIO(csv_text)))

    assert rows[0]["date"] == "2026-03-29"
    assert rows[0]["factor_id"] == "aqr_qmj_usa"
    assert rows[0]["factor_name"] == "AQR Quality Minus Junk USA"
    assert rows[0]["value"] == "0.01"
    assert rows[0]["source_dataset"] == "aqr_public_style_factors"
    assert rows[2]["factor_id"] == "aqr_qmj_global_ex_usa"
    assert len(rows) == 3


def test_fama_french_monthly_external_import_display_projection_is_chinese_refined() -> None:
    previous_name = "[外部] - US research factors monthly (Monthly) [Refined]"

    projection = external_factor_import_display_projection_v1(
        source_id="fama_french",
        dataset_key="fama_french_us_research_factors_monthly",
        frequency="MONTHLY",
        factor_id="s_f2_mom_raw_cur_external_fama_french_us_research_factors_monthly",
        factor_name="US research factors monthly",
        previous_display_name=previous_name,
        op_status={"completed": ["W", "N", "Z", "T"]},
    )

    expected = "[外部] - Fama-French 美股研究月频因子 (Monthly) [Refined]"
    assert projection["display_name_cn"] == expected
    assert projection["base_display_name_cn"] == expected
    assert previous_name in projection["legacy_name_aliases"]
    components = projection["name_audit"]["structured_components"]
    assert components["style_family"] == "[外部]"
    assert components["core_semantic"] == "Fama-French 美股研究月频因子"
    assert components["frequency_label"] == "Monthly"
    assert components["governance_tag"] == "Refined"


def test_aqr_external_import_display_projection_is_chinese_refined() -> None:
    previous_name = "[外部] - AQR style and alternative factors (Daily) [Refined]"

    projection = external_factor_import_display_projection_v1(
        source_id="aqr",
        dataset_key="aqr_public_style_factors",
        frequency="DAILY",
        factor_id="aqr_public_style_factors",
        factor_name="AQR style and alternative factors",
        previous_display_name=previous_name,
        op_status={"completed": ["W", "N", "Z", "T"]},
    )

    expected = "[外部] - AQR 学术风格与替代因子 (日频) [精炼]"
    assert projection["display_name_cn"] == expected
    assert projection["base_display_name_cn"] == expected
    assert previous_name in projection["legacy_name_aliases"]
    components = projection["name_audit"]["structured_components"]
    assert components["style_family"] == "[外部]"
    assert components["core_semantic"] == "AQR 学术风格与替代因子"
    assert components["frequency_label"] == "日频"
    assert components["governance_tag"] == "Refined"
    assert components["source_label"] == "AQR Public Data"


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
    assert "AUTO_DOWNLOAD" in sources["aqr"]["supported_import_modes"]
    assert "SOURCE_MANIFEST" in sources["aqr"]["supported_import_modes"]


def test_auto_download_precheck_builds_source_manifest_and_can_submit_review(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    _install_fama_french_download_fixture(client)

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
    assert job["manifest"]["parsing_status"] == "READY"
    assert job["manifest"]["row_count"] == 18
    assert job["manifest"]["columns"][:3] == ["date", "factor_id", "factor_name"]
    assert job["artifact_paths"]["uploaded_file_id"]
    assert {row["target_field"] for row in job["mapping_rows"] if row["required"]} == {
        "date",
        "factor_id",
        "value",
    }
    assert job["next_actions"] == ["inspect_manifest", "submit_review"]

    submitted = assert_ok(client.post(f"/factor-sources/import-jobs/{job['id']}/submit-review"))
    assert submitted["status"] == "REVIEW_SUBMITTED"
    assert submitted["review_status"] == "SUBMITTED"


def test_license_required_source_manifest_precheck_does_not_auto_download(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)

    response = client.post(
        "/factor-sources/import-jobs",
        json={
            "source_id": "aqr",
            "dataset_key": "aqr_public_style_factors",
            "import_mode": "SOURCE_MANIFEST",
            "frequency": "DAILY",
        },
    )
    job = assert_ok(response)

    assert job["source_id"] == "aqr"
    assert job["import_mode"] == "SOURCE_MANIFEST"
    assert job["status"] == "REVIEW_GATED"
    assert job["review_status"] == "PENDING_REVIEW"
    assert job["manifest"]["parsing_status"] == "SOURCE_MANIFEST_READY"
    assert job["manifest"]["row_count"] == 0
    assert "SOURCE_FILE_NOT_MATERIALIZED" in job["risk_flags"]
    assert "LICENSE_ATTESTATION_REQUIRED" in job["risk_flags"]
    assert job["next_actions"] == ["upload_source_file", "inspect_manifest"]

    overview = assert_ok(client.get("/factor-factory/overview"))
    precheck_jobs = overview["external_import_precheck_jobs"]
    assert precheck_jobs["summary"]["total"] == 1
    assert precheck_jobs["items"][0]["id"] == job["id"]
    assert precheck_jobs["items"][0]["review_status"] == "PENDING_REVIEW"
    assert precheck_jobs["items"][0]["next_actions"] == ["upload_source_file", "inspect_manifest"]
    assert overview["external_import_review_queue"]["summary"]["total"] == 0

    blocked = client.post(f"/factor-sources/import-jobs/{job['id']}/submit-review")
    assert blocked.status_code == 400
    assert "源文件" in blocked.json()["message"]
    overview_after = assert_ok(client.get("/factor-factory/overview"))
    assert overview_after["external_import_precheck_jobs"]["summary"]["total"] == 1
    assert overview_after["external_import_review_queue"]["summary"]["total"] == 0
    assert overview_after["external_import_quarantine"]["summary"]["total"] == 0


def test_aqr_source_manifest_can_materialize_public_workbook_and_submit(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    _install_aqr_download_fixture(client)

    job = assert_ok(
        client.post(
            "/factor-sources/import-jobs",
            json={
                "source_id": "aqr",
                "dataset_key": "aqr_public_style_factors",
                "import_mode": "SOURCE_MANIFEST",
                "frequency": "DAILY",
            },
        )
    )
    assert job["review_status"] == "PENDING_REVIEW"
    assert job["manifest"]["row_count"] == 0

    materialized = assert_ok(client.post(f"/factor-sources/import-jobs/{job['id']}/materialize-source-file"))
    assert materialized["import_mode"] == "AUTO_DOWNLOAD"
    assert materialized["review_status"] == "READY_FOR_REVIEW"
    assert materialized["manifest"]["row_count"] == 3
    assert materialized["manifest"]["parsing_status"] == "READY"
    assert materialized["artifact_paths"]["uploaded_file_id"]
    assert materialized["artifact_paths"]["raw_file_ref"]
    assert materialized["next_actions"] == ["inspect_manifest", "submit_review"]

    submitted = assert_ok(client.post(f"/factor-sources/import-jobs/{job['id']}/submit-review"))
    assert submitted["status"] == "REVIEW_SUBMITTED"
    assert submitted["review_status"] == "SUBMITTED"
    assert submitted["next_actions"] == ["b3_quarantine_completed"]

    overview = assert_ok(client.get("/factor-factory/overview"))
    external_quarantine = overview["external_import_quarantine"]
    expected_display_name = "[外部] - AQR 学术风格与替代因子 (日频) [精炼]"
    item = external_quarantine["items"][0]
    assert external_quarantine["summary"]["total"] == 1
    assert item["source_mining_job_id"] == job["id"]
    assert item["status"] == "PASSED"
    assert item["display_name_cn"] == expected_display_name
    assert item["base_display_name_cn"] == expected_display_name
    assert item["candidate_metrics"]["external_import_display_name"] == expected_display_name
    assert item["name_audit"]["structured_components"]["core_semantic"] == "AQR 学术风格与替代因子"
    assert item["name_audit"]["structured_components"]["frequency_label"] == "日频"
    assert item["name_audit"]["structured_components"]["governance_tag"] == "Refined"

    published = assert_ok(
        client.post(
            f"/factor-quarantine/candidates/{item['id']}/publish",
            json={"operator": "system_rule"},
        )
    )
    published_factor_id = published["factor"]["id"]
    assert published_factor_id == "s_f2_mom_raw_cur_external_aqr_public_style_factors"
    factor_list = assert_ok(client.get("/factors?lifecycle=all"))
    listed_factor = next(row for row in factor_list["items"] if row["id"] == published_factor_id)
    factor_detail = assert_ok(client.get(f"/factors/{published_factor_id}"))
    for projected in (listed_factor, factor_detail):
        assert projected["name"] == expected_display_name
        assert projected["display_name_cn"] == expected_display_name
        assert projected["base_display_name_cn"] == expected_display_name
        assert "[外部] - [外部]" not in projected["display_name_cn"]
        assert projected["factor_family"] == "其他"
        assert projected["name_audit"]["structured_components"]["style_family"] == "[外部]"


def test_materialization_blocked_source_manifest_submission_projects_back_to_precheck(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)

    job = assert_ok(
        client.post(
            "/factor-sources/import-jobs",
            json={
                "source_id": "aqr",
                "dataset_key": "aqr_public_style_factors",
                "import_mode": "SOURCE_MANIFEST",
                "frequency": "DAILY",
            },
        )
    )
    now = "2026-05-28T09:05:22Z"
    with client.app.state.service.storage.connection() as conn:
        conn.execute(
            """
            UPDATE external_factor_import_jobs
            SET status = 'REVIEW_SUBMITTED',
                review_status = 'SUBMITTED',
                submitted_at = ?,
                updated_at = ?,
                next_actions_json = ?
            WHERE id = ?
            """,
            (now, now, dumps(["b3_quarantine_completed"]), job["id"]),
        )
        conn.execute(
            """
            INSERT INTO factor_quarantine_candidates (
                id, mining_candidate_id, source_mining_job_id, expression, status,
                publish_status, gate_summary_json, cluster_id, candidate_metrics_json,
                failure_samples_json, pit_evidence_json, publish_eligibility_json,
                target_factor_id, created_at, updated_at, published_at, rejected_reason
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "fq_ext_legacy_blocked",
                "extcand_legacy_blocked",
                job["id"],
                "ExternalFactor(aqr_public_style_factors)",
                "REJECTED",
                "BLOCKED",
                dumps({"external_import": "FAILED", "manifest_row_count": 0}),
                f"external_import_{job['id']}",
                dumps({
                    "pipeline_version": "external_factor_import_v1",
                    "external_import_job_id": job["id"],
                    "manifest": {"row_count": 0, "warnings": ["source_file_not_materialized"]},
                }),
                dumps([]),
                dumps({"status": "DIAGNOSTIC_ONLY", "source": "PUBLIC_FACTOR_IMPORT"}),
                dumps({"status": "BLOCKED", "reason": "source file missing"}),
                None,
                now,
                now,
                None,
                "source file missing",
            ),
        )

    overview = assert_ok(client.get("/factor-factory/overview"))
    precheck_jobs = overview["external_import_precheck_jobs"]
    assert precheck_jobs["summary"]["total"] == 1
    assert precheck_jobs["items"][0]["id"] == job["id"]
    assert precheck_jobs["items"][0]["status"] == "REVIEW_GATED"
    assert precheck_jobs["items"][0]["review_status"] == "PENDING_REVIEW"
    assert precheck_jobs["items"][0]["next_actions"] == ["upload_source_file", "inspect_manifest"]
    assert overview["external_import_review_queue"]["summary"]["total"] == 0
    assert overview["external_import_quarantine"]["summary"]["total"] == 0

    detail = assert_ok(client.get(f"/factor-sources/import-jobs/{job['id']}"))
    assert detail["status"] == "REVIEW_GATED"
    assert detail["review_status"] == "PENDING_REVIEW"
    assert detail["submitted_at"] is None
    assert detail["next_actions"] == ["upload_source_file", "inspect_manifest"]


def test_submitted_public_factor_import_enters_b3_quarantine(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    _install_fama_french_download_fixture(client)

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
    submitted = assert_ok(client.post(f"/factor-sources/import-jobs/{job['id']}/submit-review"))

    overview = assert_ok(client.get("/factor-factory/overview"))
    assert submitted["next_actions"] == ["b3_quarantine_completed"]
    assert overview["external_import_review_queue"]["summary"]["total"] == 0
    external_quarantine = overview["external_import_quarantine"]
    item = external_quarantine["items"][0]
    assert external_quarantine["summary"]["total"] == 1
    assert item["source_mining_job_id"] == submitted["id"]
    assert item["status"] == "PASSED"
    assert item["publish_status"] == "ELIGIBLE"
    assert item["quarantine_result"] == "PASS"
    assert "可上线发布候选" in item["reason_summary"]
    assert item["candidate_metrics"]["external_import_job_id"] == submitted["id"]
    assert item["candidate_metrics"]["pipeline_version"] == "external_factor_import_v1"
    assert item["candidate_metrics"]["manifest"]["row_count"] == 18
    assert item["candidate_metrics"]["external_diagnostics"]["factor_count"] == 6
    assert item["display_name_cn"] == "[外部] - Fama-French 美股研究日频因子 (Daily) [Refined]"
    assert item["base_display_name_cn"] == "[外部] - Fama-French 美股研究日频因子 (Daily) [Refined]"
    assert item["target_factor_id"] == "s_f2_mom_raw_cur_external_fama_french_us_research_factors_daily"
    assert item["name_audit"]["structured_components"]["style_family"] == "[外部]"
    assert item["name_audit"]["structured_components"]["core_semantic"] == "Fama-French 美股研究日频因子"
    assert item["name_audit"]["structured_components"]["governance_tag"] == "Refined"
    assert item["name_audit"]["expert_review"]["architect_recommendations"]
    publishable = overview["publishable_factors"]
    assert [row["candidate_id"] for row in publishable] == [item["id"]]
    assert publishable[0]["display_name_cn"] == "[外部] - Fama-French 美股研究日频因子 (Daily) [Refined]"
    assert publishable[0]["name_audit"]["structured_components"]["frequency_label"] == "Daily"
    assert publishable[0]["publish_eligibility"]["status"] == "ELIGIBLE"

    published = assert_ok(
        client.post(
            f"/factor-quarantine/candidates/{item['id']}/publish",
            json={"operator": "system_rule"},
        )
    )
    published_factor_id = published["factor"]["id"]
    assert published_factor_id == "s_f2_mom_raw_cur_external_fama_french_us_research_factors_daily"
    factor_list = assert_ok(client.get("/factors?lifecycle=all"))
    listed_factor = next(row for row in factor_list["items"] if row["id"] == published_factor_id)
    factor_detail = assert_ok(client.get(f"/factors/{published_factor_id}"))
    for projected in (listed_factor, factor_detail):
        assert projected["name"] == "[外部] - Fama-French 美股研究日频因子 (Daily) [Refined]"
        assert projected["display_name_cn"] == "[外部] - Fama-French 美股研究日频因子 (Daily) [Refined]"
        assert projected["base_display_name_cn"] == "[外部] - Fama-French 美股研究日频因子 (Daily) [Refined]"
        assert projected["name_audit"]["structured_components"]["style_family"] == "[外部]"
        assert projected["name_audit"]["structured_components"]["core_semantic"] == "Fama-French 美股研究日频因子"
        assert projected["name_audit"]["structured_components"]["governance_tag"] == "Refined"
    assert factor_detail["name_audit"]["expert_review"]["architect_recommendations"][1].startswith("尝试 TS_Mean")

    with client.app.state.service.storage.connection() as conn:
        persisted = conn.execute(
            """
            SELECT target_factor_id, candidate_metrics_json
            FROM factor_quarantine_candidates
            WHERE id = ?
            """,
            (item["id"],),
        ).fetchone()
        assert persisted["target_factor_id"] == "s_f2_mom_raw_cur_external_fama_french_us_research_factors_daily"
        persisted_metrics = json.loads(persisted["candidate_metrics_json"])
        assert persisted_metrics["external_import_display_name"] == "[外部] - Fama-French 美股研究日频因子 (Daily) [Refined]"
        assert persisted_metrics["wnzt_complete"] is True
        assert persisted_metrics["wnzt_evidence"]["source"] == "PUBLIC_FACTOR_IMPORT_B3"
        quarantine_count = conn.execute(
            """
            SELECT COUNT(*) AS count
            FROM factor_quarantine_candidates
            WHERE source_mining_job_id = ? OR mining_candidate_id = ? OR id = ?
            """,
            (submitted["id"], submitted["id"], submitted["id"]),
        ).fetchone()["count"]
    assert quarantine_count == 1


def test_submitted_public_factor_import_remains_publishable_with_current_factory_batch(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    _install_fama_french_download_fixture(client)

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
    submitted = assert_ok(client.post(f"/factor-sources/import-jobs/{job['id']}/submit-review"))
    latest_factory_source = _insert_completed_factory_run(client.app.state.service, tmp_path / "factory-artifacts")

    overview = assert_ok(client.get("/factor-factory/overview"))
    external_item = overview["external_import_quarantine"]["items"][0]
    publishable_by_candidate = {row["candidate_id"]: row for row in overview["publishable_factors"]}

    assert overview["batch_lineage"]["source_job_id"] == latest_factory_source
    assert overview["batch_lineage"]["publishable_total"] == 0
    assert external_item["source_mining_job_id"] == submitted["id"]
    assert external_item["status"] == "PASSED"
    assert external_item["publish_status"] == "ELIGIBLE"
    assert external_item["id"] in publishable_by_candidate
    assert publishable_by_candidate[external_item["id"]]["display_name_cn"] == external_item["display_name_cn"]
    assert overview["task_summary"]["publishable_count"] == 1


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


def test_vibe_alpha_zoo_local_file_submit_stages_raw_f2_not_quarantine(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    upload = assert_ok(
        client.post(
            "/factor-sources/local-files",
            json={
                "source_id": "vibe_alpha_zoo",
                "dataset_key": "vibe_qlib158",
                "filename": "vibe-alpha-zoo.csv",
                "content_text": VIBE_ALPHA_ZOO_SAMPLE,
                "content_type": "text/csv",
            },
        )
    )

    job = assert_ok(
        client.post(
            "/factor-sources/import-jobs",
            json={
                "source_id": "vibe_alpha_zoo",
                "dataset_key": "vibe_qlib158",
                "import_mode": "LOCAL_FILE",
                "file_id": upload["file_id"],
                "frequency": "MIXED",
            },
        )
    )

    assert job["review_status"] == "READY_FOR_REVIEW"
    assert job["governance_gate"] == "RAW_F2_BEFORE_D2_QUARANTINE"
    assert job["manifest"]["catalog_manifest"]["supported_formula_count"] == 2
    assert job["manifest"]["bench_summary"]["reversed_count"] == 1
    assert "RAW_F2_ONLY_NO_DIRECT_PUBLISH" in job["risk_flags"]
    assert "AST_SCAN_BLOCKED_FORMULAS" in job["risk_flags"]

    submitted = assert_ok(client.post(f"/factor-sources/import-jobs/{job['id']}/submit-review"))
    raw_batch = submitted["raw_f2_batch"]
    mining_job_id = raw_batch["mining_job_id"]

    assert submitted["status"] == "REVIEW_SUBMITTED"
    assert submitted["review_status"] == "SUBMITTED"
    assert submitted["next_actions"] == ["raw_f2_batch_created", "wnzt_refinement_required"]
    assert raw_batch["raw_f2_count"] == 2
    assert raw_batch["refined_count"] == 0

    mining_candidates = client.app.state.service.storage.fetch_all(
        "SELECT * FROM factor_mining_candidates WHERE job_id = ? ORDER BY id",
        (mining_job_id,),
    )
    assert len(mining_candidates) == 2
    for row in mining_candidates:
        metrics = json.loads(row["summary_json"])
        assert metrics["raw_f2"] is True
        assert metrics["refined_f2"] is False
        assert metrics["wnzt_complete"] is False
        assert metrics["external_import_job_id"] == submitted["id"]

    queue = assert_ok(client.get(f"/factor-quarantine/candidates?source_job_id={mining_job_id}"))
    assert queue["summary"]["total"] == 0
    intake = assert_ok(client.post("/factor-quarantine/intake", json={"mining_job_id": mining_job_id}))
    assert intake["items"] == []
    assert intake["summary"]["skipped_raw_f2_needs_refinement_count"] == 2

    factor_rows = client.app.state.service.storage.fetch_all(
        "SELECT * FROM factor_definitions WHERE source = 'PUBLIC_FACTOR_IMPORT'"
    )
    assert factor_rows == []

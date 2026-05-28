from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from grit_backtest_platform.structured_notes import evaluate_fcn_note_signals, parse_sec_424b2_structured_note
from tests.api_test_support import assert_ok, create_test_client
from tests.test_sec_424b2_parser import BOFA_424B2_HTML, JPM_424B2_HTML


def _runtime_dir(name: str) -> Path:
    path = Path(".tmp") / "pytest-runtime" / f"{name}-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _persist_fixture(client, *, accession: str, html: str = JPM_424B2_HTML) -> dict:
    return assert_ok(
        client.post(
            "/structured-notes/sec-424b2/parse-preview",
            json={
                "issuer_cik": "0001665650",
                "accession_number": accession,
                "html": html,
                "persist": True,
            },
        )
    )


def test_structured_note_factor_definitions_are_stable_catalog_not_note_instances() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-definitions"))

    definitions = assert_ok(client.get("/structured-notes/fcn/factor-definitions"))

    f1_ids = {
        item["definition_id"]
        for item in definitions["definitions"]
        if item["layer"] == "F1"
    }
    f2_ids = {
        item["definition_id"]
        for item in definitions["definitions"]
        if item["layer"] == "F2"
    }
    assert 25 <= len(f1_ids) <= 40
    assert 8 <= len(f2_ids) <= 15
    assert "f1_fcn_underlying_count" in f1_ids
    assert "f1_fcn_underlying_initial_value" in f1_ids
    assert "f2_fcn_worst_performance" in f2_ids
    assert not any("014078" in definition_id for definition_id in f1_ids | f2_ids)
    assert definitions["summary"]["note_instance_count"] == 0


def test_definition_bindings_use_read_through_f1_cache_and_return_deepcopy() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-f1-cache"))
    parsed = _persist_fixture(client, accession="0001918704-26-014078")
    note_id = parsed["note"]["note_id"]
    service = client.app.state.service

    first = assert_ok(client.get(f"/structured-notes/fcn/instances/{note_id}/definition-bindings"))
    second = assert_ok(client.get(f"/structured-notes/fcn/instances/{note_id}/definition-bindings"))

    assert first["summary"]["f1_static_cache_status"] == "MISS"
    assert second["summary"]["f1_static_cache_status"] == "HIT"
    assert second["f1_bundle"]["underlying_count"] == 3
    assert [slot["underlying_index"] for slot in second["f1_bundle"]["underlying_slots"]] == [0, 1, 2]

    direct = service.get_structured_note_f1_static_bundle(note_id)
    direct["underlying_slots"][0]["ticker"] = "BROKEN"
    clean = service.get_structured_note_f1_static_bundle(note_id)
    assert clean["underlying_slots"][0]["ticker"] == "NVDA"

    _persist_fixture(client, accession="0001918704-26-014078")
    after_persist = assert_ok(client.get(f"/structured-notes/fcn/instances/{note_id}/definition-bindings"))
    assert after_persist["summary"]["f1_static_cache_status"] == "MISS"


def test_f2_contract_expands_underlyings_by_slot_count_not_fixed_width() -> None:
    one = parse_sec_424b2_structured_note(BOFA_424B2_HTML, issuer_cik="0000070858")
    three = parse_sec_424b2_structured_note(JPM_424B2_HTML, issuer_cik="0001665650")
    two_underlyings = three["underlyings"][:2]

    one_signal = evaluate_fcn_note_signals(one["note"], one["underlyings"], {"AAPL": 180.0})
    two_signal = evaluate_fcn_note_signals(three["note"], two_underlyings, {"NVDA": 90.0, "MSFT": 180.0})
    three_signal = evaluate_fcn_note_signals(
        three["note"],
        three["underlyings"],
        {"NVDA": 90.0, "MSFT": 180.0, "TSLA": 270.0},
    )

    assert one["f2_contract"]["underlying_count"] == 1
    assert three["f2_contract"]["underlying_count"] == 3
    assert "Range(f1_fcn_underlying_count(note_id))" in three["f2_contract"]["expressions"][0]["expression"]
    assert one_signal["status"] == "OK"
    assert two_signal["status"] == "OK"
    assert three_signal["status"] == "OK"

    blocked = evaluate_fcn_note_signals(three["note"], three["underlyings"], {"NVDA": 90.0, "MSFT": 180.0})
    assert blocked["status"] == "DATA_SOURCE_BLOCKED"
    assert blocked["missing_underlyings"] == ["TSLA"]


def test_definition_counts_stay_stable_while_note_instances_grow() -> None:
    client, _db_path = create_test_client(_runtime_dir("structured-note-definition-scale"))
    before = assert_ok(client.get("/structured-notes/fcn/factor-definitions"))

    for index in range(100):
        _persist_fixture(client, accession=f"0001918704-26-{14078 + index:06d}")

    definitions = assert_ok(client.get("/structured-notes/fcn/factor-definitions"))

    assert definitions["summary"]["note_instance_count"] == 100
    assert definitions["summary"]["f1_definition_count"] == before["summary"]["f1_definition_count"]
    assert definitions["summary"]["f2_definition_count"] == before["summary"]["f2_definition_count"]
    assert 25 <= definitions["summary"]["f1_definition_count"] <= 40
    assert 8 <= definitions["summary"]["f2_definition_count"] <= 15

from __future__ import annotations

import hashlib
import json
import math
import re
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from html import unescape
from html.parser import HTMLParser
from typing import Any, Mapping, Sequence


SEC_424B2_PARSER_VERSION = "sec_424b2_contract_skeleton_v1"
SEC_424B2_RULEPACK_ID = "sec_424b2_rulepack_v1"
SEC_424B2_PARSER_RULE_HASH = hashlib.sha256(SEC_424B2_RULEPACK_ID.encode("utf-8")).hexdigest()
STRUCTURED_NOTE_OUTPUT_DIMENSION = "note_date"
STRUCTURED_NOTE_PUBLISH_BOUNDARY = "sandbox -> quarantine -> publish"
STRUCTURED_NOTE_DEFINITION_VERSION = "sec_424b2_fcn_definitions_v1"


FCN_F1_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {"definition_id": "f1_fcn_note_id", "layer": "F1", "output_dimension": "note_static", "name": "FCN Note ID"},
    {"definition_id": "f1_fcn_issuer_cik", "layer": "F1", "output_dimension": "note_static", "name": "Issuer CIK"},
    {"definition_id": "f1_fcn_accession_number", "layer": "F1", "output_dimension": "note_static", "name": "SEC accession"},
    {"definition_id": "f1_fcn_primary_document", "layer": "F1", "output_dimension": "note_static", "name": "Primary document"},
    {"definition_id": "f1_fcn_source_url", "layer": "F1", "output_dimension": "note_static", "name": "SEC archive URL"},
    {"definition_id": "f1_fcn_cusip", "layer": "F1", "output_dimension": "note_static", "name": "CUSIP"},
    {"definition_id": "f1_fcn_pricing_date", "layer": "F1", "output_dimension": "note_static", "name": "Pricing date"},
    {"definition_id": "f1_fcn_issue_date", "layer": "F1", "output_dimension": "note_static", "name": "Issue date"},
    {"definition_id": "f1_fcn_maturity_date", "layer": "F1", "output_dimension": "note_static", "name": "Maturity date"},
    {"definition_id": "f1_fcn_coupon_rate_annual", "layer": "F1", "output_dimension": "note_static", "name": "Annual coupon rate"},
    {"definition_id": "f1_fcn_coupon_frequency", "layer": "F1", "output_dimension": "note_static", "name": "Coupon frequency"},
    {"definition_id": "f1_fcn_observation_frequency", "layer": "F1", "output_dimension": "note_static", "name": "Observation frequency"},
    {"definition_id": "f1_fcn_autocall_frequency", "layer": "F1", "output_dimension": "note_static", "name": "Autocall frequency"},
    {"definition_id": "f1_fcn_memory_feature", "layer": "F1", "output_dimension": "note_static", "name": "Memory feature"},
    {"definition_id": "f1_fcn_payoff_type", "layer": "F1", "output_dimension": "note_static", "name": "Payoff type"},
    {"definition_id": "f1_fcn_barrier_ratio", "layer": "F1", "output_dimension": "note_static", "name": "Note barrier ratio"},
    {"definition_id": "f1_fcn_trigger_ratio", "layer": "F1", "output_dimension": "note_static", "name": "Note trigger ratio"},
    {"definition_id": "f1_fcn_call_threshold_ratio", "layer": "F1", "output_dimension": "note_static", "name": "Call threshold ratio"},
    {"definition_id": "f1_fcn_review_status", "layer": "F1", "output_dimension": "note_static", "name": "Review status"},
    {"definition_id": "f1_fcn_underlying_count", "layer": "F1", "output_dimension": "note_static", "name": "Underlying count"},
    {"definition_id": "f1_fcn_underlying_slot_index", "layer": "F1", "output_dimension": "note_underlying", "name": "Underlying slot index"},
    {"definition_id": "f1_fcn_underlying_ticker", "layer": "F1", "output_dimension": "note_underlying", "name": "Underlying ticker"},
    {"definition_id": "f1_fcn_underlying_initial_value", "layer": "F1", "output_dimension": "note_underlying", "name": "Underlying initial value"},
    {"definition_id": "f1_fcn_underlying_strike_value", "layer": "F1", "output_dimension": "note_underlying", "name": "Underlying strike value"},
    {"definition_id": "f1_fcn_underlying_barrier_ratio", "layer": "F1", "output_dimension": "note_underlying", "name": "Underlying barrier ratio"},
    {"definition_id": "f1_fcn_underlying_barrier_value", "layer": "F1", "output_dimension": "note_underlying", "name": "Underlying barrier value"},
    {"definition_id": "f1_fcn_underlying_trigger_ratio", "layer": "F1", "output_dimension": "note_underlying", "name": "Underlying trigger ratio"},
    {"definition_id": "f1_fcn_underlying_trigger_value", "layer": "F1", "output_dimension": "note_underlying", "name": "Underlying trigger value"},
    {"definition_id": "f1_fcn_underlying_exchange", "layer": "F1", "output_dimension": "note_underlying", "name": "Underlying exchange"},
    {"definition_id": "f1_fcn_parser_version", "layer": "F1", "output_dimension": "note_static", "name": "Parser version"},
    {"definition_id": "f1_fcn_parser_rule_hash", "layer": "F1", "output_dimension": "note_static", "name": "Parser rule hash"},
    {"definition_id": "f1_fcn_raw_html_sha256", "layer": "F1", "output_dimension": "note_static", "name": "Raw HTML SHA256"},
    {"definition_id": "f1_fcn_table_signature_hash", "layer": "F1", "output_dimension": "note_static", "name": "Table signature hash"},
)


FCN_F2_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {"definition_id": "f2_fcn_worst_performance", "layer": "F2", "output_dimension": "note_date", "name": "FCN_Worst_Performance"},
    {"definition_id": "f2_fcn_coupon_eligibility", "layer": "F2", "output_dimension": "note_date", "name": "FCN_Coupon_Eligibility"},
    {"definition_id": "f2_fcn_coupon_signal", "layer": "F2", "output_dimension": "note_date", "name": "FCN_Coupon_Signal"},
    {"definition_id": "f2_fcn_autocall_trigger", "layer": "F2", "output_dimension": "note_date", "name": "FCN_Autocall_Trigger"},
    {"definition_id": "f2_fcn_distance_to_barrier", "layer": "F2", "output_dimension": "note_date", "name": "FCN_Distance_To_Barrier"},
    {"definition_id": "f2_fcn_memory_coupon_state", "layer": "F2", "output_dimension": "note_date", "name": "FCN_Memory_Coupon_State"},
    {"definition_id": "f2_fcn_knock_in_state", "layer": "F2", "output_dimension": "note_date", "name": "FCN_Knock_In_State"},
    {"definition_id": "f2_fcn_maturity_loss_exposure", "layer": "F2", "output_dimension": "note_date", "name": "FCN_Maturity_Loss_Exposure"},
    {"definition_id": "f2_fcn_net_benefit", "layer": "F2", "output_dimension": "note_date", "name": "FCN_Net_Benefit"},
    {"definition_id": "f2_fcn_barrier_pressure", "layer": "F2", "output_dimension": "note_date", "name": "FCN_Barrier_Pressure"},
)


_DATE_PATTERNS = ("%B %d, %Y", "%b %d, %Y", "%Y-%m-%d")
_MONTH_RE = (
    r"(January|February|March|April|May|June|July|August|September|October|November|December|"
    r"Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?)"
)
_DATE_RE = re.compile(rf"{_MONTH_RE}\s+\d{{1,2}},\s+\d{{4}}|\d{{4}}-\d{{2}}-\d{{2}}", re.IGNORECASE)
_PERCENT_RE = re.compile(r"(?P<number>-?\d+(?:\.\d+)?)\s*%")
_MONEY_RE = re.compile(r"\$\s*(?P<number>-?\d+(?:,\d{3})*(?:\.\d+)?)")
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")
_TICKER_RE = re.compile(r"\b[A-Z]{1,5}(?:[.-][A-Z])?\b")
_TICKER_EXCLUSIONS = {
    "A",
    "AND",
    "BAC",
    "CALL",
    "CIK",
    "CUSIP",
    "EDGAR",
    "ETF",
    "FINAL",
    "FORM",
    "JPM",
    "LLC",
    "NASDAQ",
    "NYSE",
    "SEC",
    "THE",
    "US",
    "USD",
}


def normalize_text(value: Any) -> str:
    text = unescape(str(value or ""))
    text = text.replace("\xa0", " ")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    return re.sub(r"\s+", " ", text).strip()


def _parse_float(value: Any) -> float | None:
    text = str(value or "").replace(",", "").strip()
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def parse_percent(value: Any) -> float | None:
    match = _PERCENT_RE.search(str(value or ""))
    if not match:
        return None
    number = _parse_float(match.group("number"))
    return None if number is None else number / 100.0


def parse_money(value: Any) -> float | None:
    match = _MONEY_RE.search(str(value or ""))
    if not match:
        return None
    return _parse_float(match.group("number"))


def parse_date(value: Any) -> str | None:
    text = normalize_text(value)
    match = _DATE_RE.search(text)
    if not match:
        return None
    raw = match.group(0).replace(".", "")
    for pattern in _DATE_PATTERNS:
        try:
            return datetime.strptime(raw, pattern).date().isoformat()
        except ValueError:
            continue
    return None


def _stable_id(prefix: str, *parts: Any, length: int = 12) -> str:
    digest = hashlib.sha256("|".join(str(part or "") for part in parts).encode("utf-8")).hexdigest()
    return f"{prefix}_{digest[:length]}"


def _stable_json_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def structured_note_factor_definitions() -> list[dict[str, Any]]:
    definitions: list[dict[str, Any]] = []
    for item in (*FCN_F1_DEFINITIONS, *FCN_F2_DEFINITIONS):
        definition = deepcopy(item)
        definition.setdefault("version", STRUCTURED_NOTE_DEFINITION_VERSION)
        definition.setdefault("publish_boundary", STRUCTURED_NOTE_PUBLISH_BOUNDARY)
        definition.setdefault("description_cn", "")
        definition.setdefault("argument_schema", {})
        definitions.append(definition)
    return definitions


def structured_note_definition_ids(layer: str | None = None) -> list[str]:
    normalized = str(layer or "").upper()
    definitions = structured_note_factor_definitions()
    return [
        str(item["definition_id"])
        for item in definitions
        if not normalized or str(item.get("layer") or "").upper() == normalized
    ]


@dataclass(frozen=True)
class ParsedHtmlTable:
    table_index: int
    rows: tuple[tuple[str, ...], ...]


class _TableCollectingParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text_parts: list[str] = []
        self.raw_tables: list[list[list[dict[str, Any]]]] = []
        self._skip_depth = 0
        self._current_table: list[list[dict[str, Any]]] | None = None
        self._current_row: list[dict[str, Any]] | None = None
        self._current_cell: dict[str, Any] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        if tag in {"script", "style"}:
            self._skip_depth += 1
            return
        if tag == "table":
            self._current_table = []
            return
        if tag == "tr" and self._current_table is not None:
            self._current_row = []
            return
        if tag in {"td", "th"} and self._current_row is not None:
            attr_map = {name.lower(): value for name, value in attrs}
            self._current_cell = {
                "text_parts": [],
                "rowspan": _positive_int(attr_map.get("rowspan"), default=1),
                "colspan": _positive_int(attr_map.get("colspan"), default=1),
                "is_header": tag == "th",
            }

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"script", "style"} and self._skip_depth:
            self._skip_depth -= 1
            return
        if tag in {"td", "th"} and self._current_cell is not None and self._current_row is not None:
            text = normalize_text(" ".join(self._current_cell.get("text_parts") or []))
            self._current_row.append({**self._current_cell, "text": text})
            self._current_cell = None
            return
        if tag == "tr" and self._current_table is not None and self._current_row is not None:
            self._current_table.append(self._current_row)
            self._current_row = None
            return
        if tag == "table" and self._current_table is not None:
            self.raw_tables.append(self._current_table)
            self._current_table = None

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        text = normalize_text(data)
        if not text:
            return
        self.text_parts.append(text)
        if self._current_cell is not None:
            self._current_cell["text_parts"].append(text)


def _positive_int(value: Any, *, default: int) -> int:
    try:
        parsed = int(str(value or "").strip())
    except (TypeError, ValueError):
        return default
    return parsed if parsed > 0 else default


def parse_html_tables(html_text: str) -> tuple[str, tuple[ParsedHtmlTable, ...]]:
    parser = _TableCollectingParser()
    parser.feed(str(html_text or ""))
    full_text = normalize_text(" ".join(parser.text_parts))
    tables = tuple(
        ParsedHtmlTable(table_index=index, rows=tuple(tuple(row) for row in _expand_table(raw_table)))
        for index, raw_table in enumerate(parser.raw_tables)
    )
    return full_text, tables


def _expand_table(raw_table: list[list[dict[str, Any]]]) -> list[list[str]]:
    rows: list[list[str]] = []
    occupied: dict[tuple[int, int], str] = {}
    for row_index, raw_row in enumerate(raw_table):
        row: list[str] = []
        col_index = 0
        while (row_index, col_index) in occupied:
            row.append(occupied.pop((row_index, col_index)))
            col_index += 1
        for raw_cell in raw_row:
            while (row_index, col_index) in occupied:
                row.append(occupied.pop((row_index, col_index)))
                col_index += 1
            text = normalize_text(raw_cell.get("text"))
            rowspan = _positive_int(raw_cell.get("rowspan"), default=1)
            colspan = _positive_int(raw_cell.get("colspan"), default=1)
            for offset in range(colspan):
                row.append(text)
            for row_offset in range(1, rowspan):
                for col_offset in range(colspan):
                    occupied[(row_index + row_offset, col_index + col_offset)] = text
            col_index += colspan
        rows.append(row)
    return rows


def parse_sec_424b2_structured_note(
    html_text: str,
    *,
    source_url: str = "",
    issuer_cik: str = "",
    accession_number: str = "",
    primary_document: str = "",
    parser_options: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    raw_html = str(html_text or "")
    text, tables = parse_html_tables(raw_html)
    html_sha256 = hashlib.sha256(raw_html.encode("utf-8", errors="replace")).hexdigest()
    normalized_text_hash = hashlib.sha256(text.encode("utf-8", errors="replace")).hexdigest()
    table_signature_hash = _stable_json_hash(
        [
            {
                "table_index": table.table_index,
                "row_count": len(table.rows),
                "column_counts": [len(row) for row in table.rows],
                "rows": table.rows,
            }
            for table in tables
        ]
    )
    options = dict(parser_options or {})
    warnings: list[str] = []
    if options.get("allow_llm") or options.get("use_llm"):
        warnings.append("external_llm_disabled_by_contract")

    evidence: dict[str, Any] = {}
    term_payload = _extract_note_terms(text, tables, evidence)
    underlyings = _extract_underlyings(text, tables)
    default_barrier = term_payload.get("barrier_percentage")
    default_trigger = term_payload.get("trigger_percentage")
    for underlying in underlyings:
        if underlying.get("barrier_ratio") is None and default_barrier is not None:
            underlying["barrier_ratio"] = default_barrier
        if underlying.get("trigger_ratio") is None:
            underlying["trigger_ratio"] = default_trigger if default_trigger is not None else underlying.get("barrier_ratio")

    if not underlyings:
        warnings.append("underlying_tickers_missing")
    if term_payload.get("coupon_rate_annual") is None:
        warnings.append("coupon_rate_annual_missing")
    if all(item.get("barrier_ratio") is None and item.get("barrier_value") is None for item in underlyings):
        warnings.append("barrier_terms_missing")
    if term_payload.get("payoff_type") == "REVIEW_REQUIRED":
        warnings.append("unsupported_or_uncertain_payoff_type")

    accession_compact = re.sub(r"[^0-9A-Za-z]+", "", accession_number or _accession_from_url(source_url))
    note_id = _structured_note_id(issuer_cik, accession_compact, html_sha256)
    blocking_warnings = [warning for warning in warnings if warning != "external_llm_disabled_by_contract"]
    status = "PARSED" if not blocking_warnings else "REVIEW_REQUIRED"

    note = {
        "note_id": note_id,
        "factor_id": "f1_fcn_note_terms",
        "legacy_factor_id": note_id,
        "source_url": source_url,
        "issuer_cik": str(issuer_cik or "").zfill(10) if str(issuer_cik or "").strip().isdigit() else str(issuer_cik or ""),
        "accession_number": accession_number or _accession_from_url(source_url),
        "primary_document": primary_document,
        "cusip": term_payload.get("cusip"),
        "pricing_date": term_payload.get("pricing_date"),
        "issue_date": term_payload.get("issue_date"),
        "maturity_date": term_payload.get("maturity_date"),
        "coupon_rate_annual": term_payload.get("coupon_rate_annual"),
        "coupon_frequency": term_payload.get("coupon_frequency") or "",
        "observation_frequency": term_payload.get("observation_frequency") or "",
        "autocall_frequency": term_payload.get("autocall_frequency") or "",
        "memory_feature": bool(term_payload.get("memory_feature")),
        "payoff_type": term_payload.get("payoff_type") or "REVIEW_REQUIRED",
        "review_status": status,
        "underlying_tickers": [str(item.get("ticker")) for item in underlyings if item.get("ticker")],
        "underlying_count": len([item for item in underlyings if item.get("ticker")]),
        "barrier_percentage": default_barrier,
        "metadata": {
            "output_dimension": STRUCTURED_NOTE_OUTPUT_DIMENSION,
            "definition_version": STRUCTURED_NOTE_DEFINITION_VERSION,
            "parser_version": SEC_424B2_PARSER_VERSION,
            "production_llm_policy": "NO_LLM_PROD",
            "publish_boundary": STRUCTURED_NOTE_PUBLISH_BOUNDARY,
        },
        "evidence": evidence,
    }
    for index, underlying in enumerate(underlyings):
        underlying["underlying_index"] = index
        underlying["note_id"] = note_id
        underlying["source_url"] = source_url
        underlying["metadata"] = {
            **dict(underlying.get("metadata") or {}),
            "underlying_index": index,
            "output_dimension": STRUCTURED_NOTE_OUTPUT_DIMENSION,
            "definition_version": STRUCTURED_NOTE_DEFINITION_VERSION,
            "parser_version": SEC_424B2_PARSER_VERSION,
        }
        if not underlying.get("evidence"):
            underlying["evidence"] = {
                "field_path": f"underlyings[{index}]",
                "text": underlying.get("ticker") or "",
                "source_url": source_url,
            }

    f2_contract = compile_fcn_f2_contract(note, underlyings)
    parse_result_hash = _stable_json_hash(
        {
            "status": status,
            "warnings": sorted(warnings),
            "note": {
                key: value
                for key, value in note.items()
                if key not in {"note_id", "factor_id", "metadata"}
            },
            "underlyings": [
                {
                    key: value
                    for key, value in underlying.items()
                    if key not in {"note_id", "metadata"}
                }
                for underlying in sorted(underlyings, key=lambda item: str(item.get("ticker") or ""))
            ],
            "f2_expressions": [
                {
                    "name": expression.get("name"),
                    "expression": expression.get("expression"),
                    "missing_policy": expression.get("missing_policy"),
                }
                for expression in f2_contract.get("expressions", [])
            ],
        }
    )
    parse_run_id = _stable_id(
        "sec424b2_parse",
        source_url,
        accession_compact,
        html_sha256,
        SEC_424B2_PARSER_VERSION,
        SEC_424B2_PARSER_RULE_HASH,
        parse_result_hash,
    )
    parse_run = {
        "run_id": parse_run_id,
        "accession_number": note["accession_number"],
        "issuer_cik": note["issuer_cik"],
        "source_url": source_url,
        "primary_document_url": source_url,
        "raw_html_sha256": html_sha256,
        "normalized_text_hash": normalized_text_hash,
        "table_signature_hash": table_signature_hash,
        "parser_rule_hash": SEC_424B2_PARSER_RULE_HASH,
        "parse_result_hash": parse_result_hash,
        "parser_version": SEC_424B2_PARSER_VERSION,
        "status": status,
        "warnings": warnings,
        "llm_used": False,
    }
    return {
        "status": status,
        "warnings": warnings,
        "llm_used": False,
        "parse_run": parse_run,
        "note": note,
        "underlyings": underlyings,
        "f2_contract": f2_contract,
    }


def _extract_note_terms(text: str, tables: Sequence[ParsedHtmlTable], evidence: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    payload["cusip"] = _extract_regex_field(text, r"\bCUSIP\s*:?\s*([A-Z0-9]{6,12})", "cusip", evidence)
    payload["pricing_date"] = _extract_date_field(text, tables, ("Pricing Date",), "pricing_date", evidence)
    payload["issue_date"] = _extract_date_field(
        text,
        tables,
        ("Original Issue Date", "Settlement Date", "Issue Date"),
        "issue_date",
        evidence,
    )
    payload["maturity_date"] = _extract_date_field(text, tables, ("Maturity Date", "Due Date"), "maturity_date", evidence)
    coupon_source = _find_label_source(
        text,
        tables,
        ("Contingent Interest Rate", "Trigger Interest Rate", "Contingent Coupon Rate", "Interest Rate"),
    )
    if coupon_source:
        payload["coupon_rate_annual"] = _parse_percent_after_label(coupon_source["text"], ("Contingent Interest Rate", "Trigger Interest Rate", "Contingent Coupon Rate", "Interest Rate"))
        evidence["coupon_rate_annual"] = coupon_source
    else:
        payload["coupon_rate_annual"] = _first_percent_near(text, "per annum", evidence, "coupon_rate_annual")
    barrier_source = _find_label_source(
        text,
        tables,
        ("Interest Barrier", "Trigger Value", "Threshold Value", "Barrier Value"),
    )
    if barrier_source:
        payload["barrier_percentage"] = _parse_percent_after_label(
            barrier_source["text"],
            ("Interest Barrier", "Barrier Value", "Threshold Value"),
        )
        evidence["barrier_percentage"] = barrier_source
    else:
        payload["barrier_percentage"] = None
    trigger_source = _find_label_source(text, tables, ("Trigger Value", "Call Value", "Autocall Level"))
    payload["trigger_percentage"] = (
        _parse_percent_after_label(trigger_source["text"], ("Trigger Value", "Call Value", "Autocall Level"))
        if trigger_source
        else None
    )

    frequency_text = " ".join(
        source["text"]
        for source in (
            coupon_source or {},
            _find_label_source(text, tables, ("Review Dates", "Observation Dates", "Contingent Payment Dates")) or {},
        )
        if source.get("text")
    )
    payload["coupon_frequency"] = _frequency_from_text(frequency_text)
    payload["observation_frequency"] = _frequency_from_text(frequency_text or text)
    autocall_source = _find_label_source(text, tables, ("Automatic Call", "Call Observation Dates", "Auto-Callable"))
    payload["autocall_frequency"] = _frequency_from_text((autocall_source or {}).get("text") or text)
    payload["memory_feature"] = bool(re.search(r"\bmemory feature\b|previously unpaid", text, flags=re.IGNORECASE))
    has_worst = bool(re.search(r"\b(least|lesser|worst)[-\s]+performing\b", text, flags=re.IGNORECASE))
    has_autocall = bool(
        re.search(r"\bauto[-\s]?call|automatically called\b|\bcallable\b|\bredeemed early\b", text, flags=re.IGNORECASE)
    )
    has_coupon = bool(re.search(r"\bcontingent (interest|coupon)\b", text, flags=re.IGNORECASE))
    payload["payoff_type"] = (
        "AUTO_CALLABLE_CONTINGENT_INTEREST_WORST_OF"
        if has_worst and has_autocall and has_coupon
        else "REVIEW_REQUIRED"
    )
    return payload


def _extract_regex_field(text: str, pattern: str, field_path: str, evidence: dict[str, Any]) -> str | None:
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if not match:
        return None
    evidence[field_path] = {"field_path": field_path, "text": normalize_text(match.group(0))}
    return normalize_text(match.group(1))


def _extract_date_field(
    text: str,
    tables: Sequence[ParsedHtmlTable],
    labels: Sequence[str],
    field_path: str,
    evidence: dict[str, Any],
) -> str | None:
    source = _find_label_source(text, tables, labels)
    if source:
        parsed = parse_date(source["text"])
        if parsed:
            evidence[field_path] = source
            return parsed
    for label in labels:
        match = re.search(rf"{re.escape(label)}[^A-Za-z0-9]{{0,40}}(?P<date>{_DATE_RE.pattern})", text, flags=re.IGNORECASE)
        if match:
            parsed = parse_date(match.group("date"))
            if parsed:
                evidence[field_path] = {"field_path": field_path, "text": normalize_text(match.group(0))}
                return parsed
    return None


def _find_label_source(text: str, tables: Sequence[ParsedHtmlTable], labels: Sequence[str]) -> dict[str, Any] | None:
    lower_labels = tuple(label.lower() for label in labels)
    for table in tables:
        for row_index, row in enumerate(table.rows):
            for column_index, cell in enumerate(row):
                cell_lower = cell.lower()
                if not any(label in cell_lower for label in lower_labels):
                    continue
                row_text = " | ".join(item for item in row if item)
                return {
                    "field_path": lower_labels[0].replace(" ", "_"),
                    "table_index": table.table_index,
                    "row_index": row_index,
                    "column_index": column_index,
                    "text": row_text,
                }
    for label in labels:
        match = re.search(rf"{re.escape(label)}\s*:?\s*(.{{0,220}})", text, flags=re.IGNORECASE)
        if match:
            return {"field_path": label.lower().replace(" ", "_"), "text": normalize_text(match.group(0))}
    return None


def _first_percent_near(text: str, needle: str, evidence: dict[str, Any], field_path: str) -> float | None:
    index = text.lower().find(needle.lower())
    if index < 0:
        return None
    window = text[max(0, index - 180) : index + 180]
    parsed = parse_percent(window)
    if parsed is not None:
        evidence[field_path] = {"field_path": field_path, "text": normalize_text(window)}
    return parsed


def _parse_percent_after_label(text: str, labels: Sequence[str]) -> float | None:
    source = str(text or "")
    for label in labels:
        strict_match = re.search(
            rf"{re.escape(label)}\s*:\s*(?P<body>.{{0,260}})",
            source,
            flags=re.IGNORECASE,
        )
        if strict_match:
            parsed = parse_percent(strict_match.group("body"))
            if parsed is not None:
                return parsed
    lowered = source.lower()
    positions = [lowered.find(label.lower()) for label in labels if lowered.find(label.lower()) >= 0]
    if not positions:
        return parse_percent(source)
    sliced = source[min(positions) :]
    return parse_percent(sliced)


def _frequency_from_text(value: Any) -> str:
    text = str(value or "").lower()
    if "monthly" in text or "per month" in text:
        return "Monthly"
    if "quarterly" in text or "per quarter" in text:
        return "Quarterly"
    if "semi-annual" in text or "semiannual" in text:
        return "Semiannual"
    if "annual" in text or "per annum" in text:
        return "Annual"
    return ""


def _extract_underlyings(text: str, tables: Sequence[ParsedHtmlTable]) -> list[dict[str, Any]]:
    rows = _underlying_rows_from_tables(tables)
    if rows:
        return rows
    paragraph_tickers = []
    ticker_patterns = (
        r"symbol\s*:?\s*[\"']?(?P<ticker>[A-Z]{1,5}(?:[.-][A-Z])?)[\"']?",
        r"Bloomberg ticker\s*:?\s*(?P<ticker>[A-Z0-9]{1,6}(?:[.-][A-Z])?)",
    )
    for pattern in ticker_patterns:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            ticker = match.group("ticker").upper()
            if ticker not in paragraph_tickers and ticker not in _TICKER_EXCLUSIONS:
                paragraph_tickers.append(ticker)
    return [
        {
            "ticker": ticker,
            "initial_value": None,
            "strike_value": None,
            "barrier_ratio": None,
            "barrier_value": None,
            "trigger_ratio": None,
            "trigger_value": None,
            "exchange": "",
            "evidence": {"field_path": f"underlyings[{index}].ticker", "text": ticker},
            "metadata": {"source": "paragraph_symbol_pattern"},
        }
        for index, ticker in enumerate(paragraph_tickers)
    ]


def _underlying_rows_from_tables(tables: Sequence[ParsedHtmlTable]) -> list[dict[str, Any]]:
    for table in tables:
        header_index, header = _find_underlying_header(table)
        if header_index is None or header is None:
            continue
        ticker_col = _column_index(header, ("ticker", "symbol"))
        strike_col = _column_index(header, ("strike", "starting", "initial"))
        barrier_col = _column_index(header, ("barrier", "trigger", "threshold"))
        exchange_col = _column_index(header, ("exchange",))
        if ticker_col is None:
            continue
        results: list[dict[str, Any]] = []
        for row_index, row in enumerate(table.rows[header_index + 1 :], start=header_index + 1):
            row_text = " | ".join(row)
            ticker_source = row[ticker_col] if ticker_col < len(row) else row_text
            ticker = _extract_ticker(ticker_source) or _extract_ticker(row_text)
            if not ticker:
                continue
            strike_text = row[strike_col] if strike_col is not None and strike_col < len(row) else row_text
            barrier_text = row[barrier_col] if barrier_col is not None and barrier_col < len(row) else ""
            strike_value = parse_money(strike_text)
            barrier_value = parse_money(barrier_text)
            barrier_ratio = None
            if strike_value and barrier_value:
                barrier_ratio = barrier_value / strike_value
            if barrier_ratio is None:
                barrier_ratio = parse_percent(barrier_text)
            exchange = row[exchange_col] if exchange_col is not None and exchange_col < len(row) else ""
            results.append(
                {
                    "ticker": ticker,
                    "initial_value": strike_value,
                    "strike_value": strike_value,
                    "barrier_ratio": barrier_ratio,
                    "barrier_value": barrier_value,
                    "trigger_ratio": barrier_ratio,
                    "trigger_value": barrier_value,
                    "exchange": exchange,
                    "evidence": {
                        "field_path": f"underlyings.{ticker}",
                        "table_index": table.table_index,
                        "row_index": row_index,
                        "column_index": ticker_col,
                        "text": row_text,
                    },
                    "metadata": {"source": "key_terms_table"},
                }
            )
        if results:
            return results
    return []


def _find_underlying_header(table: ParsedHtmlTable) -> tuple[int | None, tuple[str, ...] | None]:
    for row_index, row in enumerate(table.rows):
        row_text = " ".join(row).lower()
        if ("ticker" in row_text or "symbol" in row_text) and (
            "strike" in row_text or "starting" in row_text or "initial" in row_text
        ):
            return row_index, row
    return None, None


def _column_index(header: Sequence[str], needles: Sequence[str]) -> int | None:
    for index, cell in enumerate(header):
        lower = str(cell or "").lower()
        if any(needle in lower for needle in needles):
            return index
    return None


def _extract_ticker(value: Any) -> str | None:
    text = normalize_text(value)
    for match in _TICKER_RE.finditer(text):
        ticker = match.group(0).upper()
        if ticker not in _TICKER_EXCLUSIONS:
            return ticker
    return None


def _accession_from_url(source_url: str) -> str:
    match = re.search(r"/([0-9]{10})([0-9]{8})([0-9]{6})/", str(source_url or ""))
    if not match:
        return ""
    raw = "".join(match.groups())
    return f"{raw[:10]}-{raw[10:12]}-{raw[12:]}"


def _structured_note_id(issuer_cik: str, accession_compact: str, html_sha256: str) -> str:
    issuer = re.sub(r"[^0-9A-Za-z]+", "", str(issuer_cik or "")).lstrip("0") or "sec"
    accession = re.sub(r"[^0-9A-Za-z]+", "", str(accession_compact or ""))
    suffix = accession[-8:] if accession else html_sha256[:8]
    return f"note_{issuer}_{suffix}"


def compile_fcn_f2_contract(note: Mapping[str, Any], underlyings: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    note_id = str(note.get("note_id") or note.get("factor_id") or "")
    sorted_underlyings = sorted(
        [dict(item) for item in underlyings if item.get("ticker")],
        key=lambda item: (
            _positive_int(
                (item.get("metadata") if isinstance(item.get("metadata"), Mapping) else {}).get("underlying_index")
                if item.get("underlying_index") is None
                else item.get("underlying_index"),
                default=0,
            ),
            str(item.get("ticker") or ""),
        ),
    )
    underlying_slots = [
        {
            "underlying_index": index,
            "ticker": str(item.get("ticker") or "").upper(),
            "initial_value": item.get("initial_value"),
            "strike_value": item.get("strike_value"),
            "barrier_ratio": item.get("barrier_ratio"),
            "barrier_value": item.get("barrier_value"),
            "trigger_ratio": item.get("trigger_ratio"),
            "trigger_value": item.get("trigger_value"),
            "exchange": str(item.get("exchange") or ""),
        }
        for index, item in enumerate(sorted_underlyings)
    ]
    tickers = [str(item.get("ticker") or "") for item in underlying_slots if item.get("ticker")]
    f1_dependencies = structured_note_definition_ids("F1")
    dependencies = [*f1_dependencies, "f1_price_adj_close"]
    expressions = [
        {
            "factor_id": "f2_fcn_worst_performance",
            "definition_id": "f2_fcn_worst_performance",
            "name": "FCN_Worst_Performance",
            "expression": (
                "TS_Min([f1_price_adj_close(note_id,slot,t) / "
                "f1_fcn_underlying_initial_value(note_id,slot) "
                "FOR slot IN Range(f1_fcn_underlying_count(note_id))])"
            ),
            "description_cn": "遍历票据底层资产，计算相对初始值表现并取最弱一只。",
            "dependencies": dependencies,
            "missing_policy": "DATA_SOURCE_BLOCKED when any underlying price or initial value is missing.",
            "output_dimension": STRUCTURED_NOTE_OUTPUT_DIMENSION,
            "argument_schema": {"note_id": "string", "t": "date"},
            "instance_binding": {"note_id": note_id, "underlying_axis": "slot"},
        },
        {
            "factor_id": "f2_fcn_coupon_eligibility",
            "definition_id": "f2_fcn_coupon_eligibility",
            "name": "FCN_Coupon_Eligibility",
            "expression": (
                "ObservationDate(note_id,t) AND NotCalled(note_id,t) AND "
                "All(slot_ratio(note_id,slot,t) >= f1_fcn_underlying_barrier_ratio(note_id,slot) "
                "FOR slot IN Range(f1_fcn_underlying_count(note_id)))"
            ),
            "description_cn": "观察日、未敲出且全部底层资产不低于票息/触发边界时为真。",
            "dependencies": dependencies,
            "missing_policy": "DATA_SOURCE_BLOCKED when observation calendar or barrier evidence is missing.",
            "output_dimension": STRUCTURED_NOTE_OUTPUT_DIMENSION,
            "argument_schema": {"note_id": "string", "t": "date"},
            "instance_binding": {"note_id": note_id, "underlying_axis": "slot"},
        },
        {
            "factor_id": "f2_fcn_coupon_signal",
            "definition_id": "f2_fcn_coupon_signal",
            "name": "FCN_Coupon_Signal",
            "expression": "IF(FCN_Coupon_Eligibility(note_id,t), f1_fcn_coupon_rate_annual / payments_per_year, 0)",
            "description_cn": "满足票息条件时输出当期票息，否则输出 0。",
            "dependencies": dependencies,
            "missing_policy": "REVIEW_REQUIRED when coupon frequency is unsupported.",
            "output_dimension": STRUCTURED_NOTE_OUTPUT_DIMENSION,
            "argument_schema": {"note_id": "string", "t": "date"},
            "instance_binding": {"note_id": note_id},
        },
        {
            "factor_id": "f2_fcn_autocall_trigger",
            "definition_id": "f2_fcn_autocall_trigger",
            "name": "FCN_Autocall_Trigger",
            "expression": (
                "NonFinalReviewDate(note_id,t) AND NotCalled(note_id,t) AND "
                "All(slot_ratio(note_id,slot,t) >= f1_fcn_call_threshold_ratio(note_id) "
                "FOR slot IN Range(f1_fcn_underlying_count(note_id)))"
            ),
            "description_cn": "非最终观察日且全部底层资产不低于敲出边界时触发敲出。",
            "dependencies": dependencies,
            "missing_policy": "REVIEW_REQUIRED when call threshold cannot be derived.",
            "output_dimension": STRUCTURED_NOTE_OUTPUT_DIMENSION,
            "argument_schema": {"note_id": "string", "t": "date"},
            "instance_binding": {"note_id": note_id, "underlying_axis": "slot"},
        },
        {
            "factor_id": "f2_fcn_distance_to_barrier",
            "definition_id": "f2_fcn_distance_to_barrier",
            "name": "FCN_Distance_To_Barrier",
            "expression": (
                "(FCN_Worst_Performance(note_id,t) - f1_fcn_barrier_ratio(note_id)) / "
                "TS_Std(FCN_Worst_Performance(note_id,*), 21)"
            ),
            "description_cn": "用 21 日波动标准化最弱表现距离敲入/触发边界的距离。",
            "dependencies": dependencies,
            "missing_policy": "REVIEW_REQUIRED when 21 observations are not available.",
            "output_dimension": STRUCTURED_NOTE_OUTPUT_DIMENSION,
            "argument_schema": {"note_id": "string", "t": "date"},
            "instance_binding": {"note_id": note_id},
        },
        {
            "factor_id": "f2_fcn_memory_coupon_state",
            "definition_id": "f2_fcn_memory_coupon_state",
            "name": "FCN_Memory_Coupon_State",
            "expression": "StatefulAccrual(unpaid_coupon_periods, release_when=FCN_Coupon_Eligibility(note_id,t))",
            "description_cn": "记忆票息的未付期数状态占位；本合同骨架只定义状态边界，不自动发布。",
            "dependencies": dependencies,
            "missing_policy": "REVIEW_REQUIRED until observation schedule is fully materialized.",
            "output_dimension": STRUCTURED_NOTE_OUTPUT_DIMENSION,
            "argument_schema": {"note_id": "string", "t": "date"},
            "instance_binding": {"note_id": note_id},
        },
        {
            "factor_id": "f2_fcn_knock_in_state",
            "definition_id": "f2_fcn_knock_in_state",
            "name": "FCN_Knock_In_State",
            "expression": "Any(slot_ratio(note_id,slot,t) < f1_fcn_underlying_trigger_ratio(note_id,slot) FOR slot IN Range(f1_fcn_underlying_count(note_id)))",
            "description_cn": "任一底层资产跌破触发/敲入边界时进入敲入状态。",
            "dependencies": dependencies,
            "missing_policy": "DATA_SOURCE_BLOCKED when trigger evidence is missing.",
            "output_dimension": STRUCTURED_NOTE_OUTPUT_DIMENSION,
            "argument_schema": {"note_id": "string", "t": "date"},
            "instance_binding": {"note_id": note_id, "underlying_axis": "slot"},
        },
        {
            "factor_id": "f2_fcn_maturity_loss_exposure",
            "definition_id": "f2_fcn_maturity_loss_exposure",
            "name": "FCN_Maturity_Loss_Exposure",
            "expression": "Max(0, 1 - FCN_Worst_Performance(note_id,t))",
            "description_cn": "到期最差资产跌幅代理，用于和累计票息做归因比较。",
            "dependencies": dependencies,
            "missing_policy": "DATA_SOURCE_BLOCKED when worst-of performance is blocked.",
            "output_dimension": STRUCTURED_NOTE_OUTPUT_DIMENSION,
            "argument_schema": {"note_id": "string", "t": "date"},
            "instance_binding": {"note_id": note_id},
        },
        {
            "factor_id": "f2_fcn_net_benefit",
            "definition_id": "f2_fcn_net_benefit",
            "name": "FCN_Net_Benefit",
            "expression": "Cumulative_Coupons(note_id,t) - Max(0, 1 - FCN_Worst_Performance(note_id,t))",
            "description_cn": "累计票息减去最差资产跌幅代理后的票息损益归因。",
            "dependencies": dependencies,
            "missing_policy": "DATA_SOURCE_BLOCKED when replay points are blocked.",
            "output_dimension": STRUCTURED_NOTE_OUTPUT_DIMENSION,
            "argument_schema": {"note_id": "string", "t": "date"},
            "instance_binding": {"note_id": note_id},
        },
        {
            "factor_id": "f2_fcn_barrier_pressure",
            "definition_id": "f2_fcn_barrier_pressure",
            "name": "FCN_Barrier_Pressure",
            "expression": "PortfolioAverage(FCN_Distance_To_Barrier(note_id,t), pilot_manifest)",
            "description_cn": "Pilot 票据池平均距离 barrier 的在途风险压力指标。",
            "dependencies": dependencies,
            "missing_policy": "DATA_SOURCE_BLOCKED when pilot coverage is below threshold.",
            "output_dimension": STRUCTURED_NOTE_OUTPUT_DIMENSION,
            "argument_schema": {"manifest_id": "string", "t": "date"},
            "instance_binding": {"note_id": note_id},
        },
    ]
    return {
        "contract_id": f"f2_contract_{note_id}",
        "note_id": note_id,
        "output_dimension": STRUCTURED_NOTE_OUTPUT_DIMENSION,
        "definition_version": STRUCTURED_NOTE_DEFINITION_VERSION,
        "source_factor_ids": dependencies,
        "underlying_tickers": tickers,
        "underlying_count": len(underlying_slots),
        "underlying_slots": underlying_slots,
        "stable_definition_count": {
            "f1": len(structured_note_definition_ids("F1")),
            "f2": len(structured_note_definition_ids("F2")),
        },
        "publish_boundary": STRUCTURED_NOTE_PUBLISH_BOUNDARY,
        "production_llm_policy": "NO_LLM_PROD",
        "expressions": expressions,
    }


def evaluate_fcn_note_signals(
    note: Mapping[str, Any],
    underlyings: Sequence[Mapping[str, Any]],
    prices: Mapping[str, float],
    *,
    is_observation_date: bool = True,
    is_final_observation: bool = False,
    already_called: bool = False,
    history_worst_performance: Sequence[float] | None = None,
) -> dict[str, Any]:
    ratios: dict[str, float] = {}
    blockers: list[str] = []
    for underlying in underlyings:
        ticker = str(underlying.get("ticker") or "").upper()
        initial = _parse_float(underlying.get("initial_value") or underlying.get("strike_value"))
        price = prices.get(ticker)
        if not ticker or initial is None or initial <= 0 or price is None:
            blockers.append(ticker or "UNKNOWN")
            continue
        ratios[ticker] = float(price) / initial
    if blockers:
        return {
            "status": "DATA_SOURCE_BLOCKED",
            "blocker_code": "DATA_SOURCE_BLOCKED",
            "missing_underlyings": blockers,
            "worst_performance": None,
            "coupon_eligible": False,
            "coupon_signal": 0.0,
            "autocall_trigger": False,
            "distance_to_barrier": None,
        }
    worst = min(ratios.values()) if ratios else None
    barrier = _note_barrier_ratio(note, underlyings)
    call_threshold = _note_call_threshold_ratio(note)
    payments_per_year = _payments_per_year(str(note.get("coupon_frequency") or ""))
    coupon_rate = _parse_float(note.get("coupon_rate_annual")) or 0.0
    all_above_barrier = bool(ratios) and all(value >= barrier for value in ratios.values())
    all_above_call = bool(ratios) and all(value >= call_threshold for value in ratios.values())
    coupon_eligible = bool(is_observation_date and not already_called and all_above_barrier)
    autocall_trigger = bool(is_observation_date and not is_final_observation and not already_called and all_above_call)
    distance = None
    history = [float(item) for item in (history_worst_performance or []) if item is not None]
    if worst is not None and len(history) >= 2:
        mean = sum(history) / len(history)
        variance = sum((item - mean) ** 2 for item in history) / len(history)
        std = math.sqrt(variance)
        if std > 0:
            distance = (worst - barrier) / std
    return {
        "status": "OK",
        "blocker_code": None,
        "ratios": ratios,
        "worst_performance": worst,
        "coupon_eligible": coupon_eligible,
        "coupon_signal": coupon_rate / payments_per_year if coupon_eligible and payments_per_year else 0.0,
        "autocall_trigger": autocall_trigger,
        "distance_to_barrier": distance,
        "barrier_ratio": barrier,
        "call_threshold_ratio": call_threshold,
    }


def _note_barrier_ratio(note: Mapping[str, Any], underlyings: Sequence[Mapping[str, Any]]) -> float:
    candidates = [
        _parse_float(item.get("barrier_ratio"))
        for item in underlyings
        if _parse_float(item.get("barrier_ratio")) is not None
    ]
    note_barrier = _parse_float(note.get("barrier_percentage"))
    if note_barrier is not None:
        candidates.append(note_barrier)
    return min(candidates) if candidates else 1.0


def _note_call_threshold_ratio(note: Mapping[str, Any]) -> float:
    metadata = note.get("metadata") if isinstance(note.get("metadata"), Mapping) else {}
    value = _parse_float(metadata.get("call_threshold_ratio")) if isinstance(metadata, Mapping) else None
    return value if value is not None else 1.0


def _payments_per_year(frequency: str) -> int:
    normalized = str(frequency or "").strip().lower()
    if normalized == "monthly":
        return 12
    if normalized == "quarterly":
        return 4
    if normalized == "semiannual":
        return 2
    if normalized == "annual":
        return 1
    return 12


def user_agent_has_contact_email(user_agent: str) -> bool:
    return bool(_EMAIL_RE.search(str(user_agent or "")))

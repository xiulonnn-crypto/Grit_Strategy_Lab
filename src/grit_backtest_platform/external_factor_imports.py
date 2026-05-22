"""Pure helpers for public factor import intake.

This module intentionally has no FastAPI, SQLite, pandas, or network
dependencies.  API and storage layers can wrap these helpers later while the
domain contract stays review-gated.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import zipfile
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence
from xml.sax.saxutils import escape


PUBLIC_FACTOR_IMPORT_SCHEMA_VERSION = "public_factor_import_v1"
PUBLIC_FACTOR_IMPORT_TEMPLATE_VERSION = "public_factor_import_template_v1"
PUBLIC_FACTOR_IMPORT_JOB_FLOW = (
    "import_file",
    "create_precheck",
    "semantic_mapping",
    "submit_review",
)
PUBLIC_FACTOR_IMPORT_INITIAL_STATUS = "REVIEW_GATED"
PUBLIC_FACTOR_IMPORT_INITIAL_REVIEW_STATE = "PENDING_REVIEW"
PUBLIC_FACTOR_IMPORT_FORBIDDEN_DIRECT_ACTIONS = ("publish", "auto_publish")

CSV_MEDIA_TYPE = "text/csv"
XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

TEMPLATE_COLUMNS = (
    "date",
    "factor_id",
    "factor_name",
    "symbol",
    "value",
    "frequency",
    "source_dataset",
    "region",
    "notes",
)
TEMPLATE_EXAMPLE_ROWS = (
    {
        "date": "2026-01-31",
        "factor_id": "ff_mkt_rf",
        "factor_name": "Market excess return",
        "symbol": "",
        "value": "0.0123",
        "frequency": "monthly",
        "source_dataset": "fama_french_us_research_factors_monthly",
        "region": "US",
        "notes": "Example market-level factor row.",
    },
    {
        "date": "2026-01-31",
        "factor_id": "custom_value_signal",
        "factor_name": "Custom value signal",
        "symbol": "AAPL",
        "value": "0.44",
        "frequency": "monthly",
        "source_dataset": "manual_upload",
        "region": "US",
        "notes": "Example security-level factor row.",
    },
)

FIELD_ALIASES: Mapping[str, tuple[str, ...]] = {
    "date": ("date", "as_of", "month", "period", "observation_date", "trade_date"),
    "factor_id": ("factor_id", "factor", "factor_code", "code", "signal_id", "name"),
    "factor_name": ("factor_name", "factor_label", "label", "description", "long_name"),
    "symbol": ("symbol", "ticker", "permno", "secid", "asset", "security"),
    "value": ("value", "factor_value", "return", "ret", "score", "weight"),
    "frequency": ("frequency", "freq", "periodicity"),
    "source_dataset": ("source_dataset", "dataset", "source", "source_id"),
    "region": ("region", "country", "market"),
    "notes": ("notes", "note", "comment", "comments"),
}


@dataclass(frozen=True)
class PublicFactorSourceDataset:
    dataset_id: str
    label: str
    frequency: str
    availability: str
    allowed_intake_modes: tuple[str, ...]
    review_notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "dataset_id": self.dataset_id,
            "label": self.label,
            "frequency": self.frequency,
            "availability": self.availability,
            "allowed_intake_modes": list(self.allowed_intake_modes),
            "review_notes": list(self.review_notes),
        }


@dataclass(frozen=True)
class PublicFactorSource:
    source_id: str
    label: str
    status: str
    license_mode: str
    intake_policy: str
    datasets: tuple[PublicFactorSourceDataset, ...]
    notes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "source_id": self.source_id,
            "label": self.label,
            "status": self.status,
            "license_mode": self.license_mode,
            "intake_policy": self.intake_policy,
            "datasets": [dataset.to_dict() for dataset in self.datasets],
            "notes": list(self.notes),
        }


@dataclass(frozen=True)
class TemplateArtifact:
    filename: str
    media_type: str
    content: bytes

    def to_response_dict(self) -> dict[str, Any]:
        return {
            "filename": self.filename,
            "media_type": self.media_type,
            "bytes": self.content,
        }


PUBLIC_FACTOR_SOURCE_REGISTRY: tuple[PublicFactorSource, ...] = (
    PublicFactorSource(
        source_id="fama_french",
        label="Fama-French Data Library",
        status="available",
        license_mode="public_research",
        intake_policy="download_or_manual_upload_review",
        datasets=(
            PublicFactorSourceDataset(
                dataset_id="fama_french_us_research_factors_daily",
                label="US research factors daily",
                frequency="daily",
                availability="public_dataset",
                allowed_intake_modes=("manual_upload", "reviewed_import"),
                review_notes=("Requires semantic mapping before factor library admission.",),
            ),
            PublicFactorSourceDataset(
                dataset_id="fama_french_us_research_factors_monthly",
                label="US research factors monthly",
                frequency="monthly",
                availability="public_dataset",
                allowed_intake_modes=("manual_upload", "reviewed_import"),
                review_notes=("Requires semantic mapping before factor library admission.",),
            ),
        ),
        notes=("Imported factors must stay review-gated until mapped and approved.",),
    ),
    PublicFactorSource(
        source_id="aqr",
        label="AQR Data Sets",
        status="manual_upload_required",
        license_mode="license/manual_upload",
        intake_policy="operator_attested_manual_upload_only",
        datasets=(
            PublicFactorSourceDataset(
                dataset_id="aqr_public_style_factors",
                label="AQR style and alternative factors",
                frequency="varies",
                availability="license/manual_upload",
                allowed_intake_modes=("manual_upload",),
                review_notes=("Operator must attest source license before review submission.",),
            ),
        ),
        notes=("No automated fetch is implied by this registry entry.",),
    ),
    PublicFactorSource(
        source_id="msci_facs",
        label="MSCI FaCS",
        status="reference_only",
        license_mode="reference-only",
        intake_policy="reference_only_no_import",
        datasets=(
            PublicFactorSourceDataset(
                dataset_id="msci_facs_reference",
                label="MSCI FaCS factor taxonomy reference",
                frequency="reference",
                availability="reference-only",
                allowed_intake_modes=(),
                review_notes=("Use for taxonomy mapping only; do not import proprietary data.",),
            ),
        ),
        notes=("Reference-only source; ingestion requires a separate approved entitlement path.",),
    ),
    PublicFactorSource(
        source_id="portfolio_visualizer",
        label="Portfolio Visualizer",
        status="reference_only",
        license_mode="reference-only",
        intake_policy="reference_only_no_import",
        datasets=(
            PublicFactorSourceDataset(
                dataset_id="portfolio_visualizer_factor_reference",
                label="Portfolio Visualizer factor model reference",
                frequency="reference",
                availability="reference-only",
                allowed_intake_modes=(),
                review_notes=("Use for cross-checking model semantics only.",),
            ),
        ),
        notes=("Reference-only source; no direct factor data import is enabled.",),
    ),
)


def list_public_factor_source_registry() -> list[dict[str, Any]]:
    return [source.to_dict() for source in PUBLIC_FACTOR_SOURCE_REGISTRY]


def get_public_factor_source(source_id: str) -> dict[str, Any] | None:
    normalized = _normalize_token(source_id)
    for source in PUBLIC_FACTOR_SOURCE_REGISTRY:
        if source.source_id == normalized:
            return source.to_dict()
    return None


def build_public_factor_csv_template() -> TemplateArtifact:
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=TEMPLATE_COLUMNS, lineterminator="\n")
    writer.writeheader()
    for row in TEMPLATE_EXAMPLE_ROWS:
        writer.writerow(row)
    return TemplateArtifact(
        filename="public_factor_import_template.csv",
        media_type=CSV_MEDIA_TYPE,
        content=buffer.getvalue().encode("utf-8"),
    )


def build_public_factor_xlsx_template() -> TemplateArtifact:
    rows = [TEMPLATE_COLUMNS, *(_row_to_values(row, TEMPLATE_COLUMNS) for row in TEMPLATE_EXAMPLE_ROWS)]
    content = _build_minimal_xlsx(rows, sheet_name="public_factor_import")
    return TemplateArtifact(
        filename="public_factor_import_template.xlsx",
        media_type=XLSX_MEDIA_TYPE,
        content=content,
    )


def analyze_public_factor_upload_text(
    text: str | bytes,
    *,
    filename: str | None = None,
    sample_limit: int = 5,
) -> dict[str, Any]:
    raw_bytes, decoded = _coerce_upload_text(text)
    sha256 = hashlib.sha256(raw_bytes).hexdigest()
    parsed_format, rows, columns = _parse_upload_rows(decoded, filename=filename)
    sample_rows = rows[: max(sample_limit, 0)]
    return {
        "schema_version": PUBLIC_FACTOR_IMPORT_SCHEMA_VERSION,
        "filename": filename or "",
        "format": parsed_format,
        "sha256": sha256,
        "row_count": len(rows),
        "columns": columns,
        "sample_rows": sample_rows,
        "field_mapping_suggestions": suggest_public_factor_field_mapping(columns),
        "precheck": build_public_factor_import_precheck(
            sha256=sha256,
            row_count=len(rows),
            columns=columns,
            sample_rows=sample_rows,
            parsed_format=parsed_format,
        ),
    }


def suggest_public_factor_field_mapping(columns: Sequence[str]) -> dict[str, str | None]:
    normalized_columns = {_normalize_column(column): column for column in columns}
    suggestions: dict[str, str | None] = {}
    for canonical, aliases in FIELD_ALIASES.items():
        suggestions[canonical] = None
        for alias in aliases:
            matched = normalized_columns.get(_normalize_column(alias))
            if matched:
                suggestions[canonical] = matched
                break
    return suggestions


def build_public_factor_import_precheck(
    *,
    sha256: str,
    row_count: int,
    columns: Sequence[str],
    sample_rows: Sequence[Mapping[str, Any]] = (),
    parsed_format: str = "unknown",
) -> dict[str, Any]:
    mapping = suggest_public_factor_field_mapping(columns)
    missing_required = [
        field
        for field in ("date", "factor_id", "value")
        if not mapping.get(field)
    ]
    return {
        "status": "PRECHECK_READY" if not missing_required else "NEEDS_MAPPING",
        "review_gate": PUBLIC_FACTOR_IMPORT_INITIAL_REVIEW_STATE,
        "can_publish": False,
        "direct_publish_allowed": False,
        "parsed_format": parsed_format,
        "sha256": sha256,
        "row_count": int(row_count),
        "columns": list(columns),
        "sample_rows": [dict(row) for row in sample_rows],
        "field_mapping_suggestions": mapping,
        "missing_required_fields": missing_required,
        "required_next_steps": list(PUBLIC_FACTOR_IMPORT_JOB_FLOW[2:]),
    }


def build_public_factor_import_job_projection(
    *,
    job_id: str,
    source_id: str,
    filename: str,
    sha256: str,
    row_count: int,
    columns: Sequence[str],
    field_mapping: Mapping[str, str | None] | None = None,
    review_submitted: bool = False,
) -> dict[str, Any]:
    mapping = dict(field_mapping or suggest_public_factor_field_mapping(columns))
    completed_steps = ["import_file", "create_precheck"]
    if any(mapping.values()):
        completed_steps.append("semantic_mapping")
    if review_submitted:
        completed_steps.append("submit_review")
    return {
        "schema_version": PUBLIC_FACTOR_IMPORT_SCHEMA_VERSION,
        "job_id": job_id,
        "source_id": _normalize_token(source_id),
        "filename": filename,
        "sha256": sha256,
        "status": PUBLIC_FACTOR_IMPORT_INITIAL_STATUS,
        "review_state": "SUBMITTED" if review_submitted else PUBLIC_FACTOR_IMPORT_INITIAL_REVIEW_STATE,
        "can_publish": False,
        "direct_publish_allowed": False,
        "forbidden_direct_actions": list(PUBLIC_FACTOR_IMPORT_FORBIDDEN_DIRECT_ACTIONS),
        "flow": list(PUBLIC_FACTOR_IMPORT_JOB_FLOW),
        "completed_steps": completed_steps,
        "next_step": _next_flow_step(completed_steps),
        "precheck": build_public_factor_import_precheck(
            sha256=sha256,
            row_count=row_count,
            columns=columns,
            parsed_format=_guess_format_from_filename(filename),
        ),
        "semantic_mapping": {
            "status": "MAPPING_READY" if any(mapping.values()) else "NEEDS_MAPPING",
            "field_mapping": mapping,
        },
    }


def _parse_upload_rows(decoded: str, *, filename: str | None = None) -> tuple[str, list[dict[str, Any]], list[str]]:
    stripped = decoded.lstrip("\ufeff\r\n\t ")
    guessed_format = _guess_format_from_filename(filename)
    if guessed_format == "json" or stripped[:1] in ("[", "{"):
        rows = _parse_json_rows(stripped)
        return "json", rows, _collect_columns(rows)
    rows = _parse_csv_rows(decoded)
    return "csv", rows, _collect_columns(rows)


def _parse_csv_rows(decoded: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(decoded))
    if not reader.fieldnames:
        return []
    return [
        {str(key): value for key, value in row.items() if key is not None}
        for row in reader
    ]


def _parse_json_rows(decoded: str) -> list[dict[str, Any]]:
    payload = json.loads(decoded or "[]")
    if isinstance(payload, list):
        return [_coerce_row(item) for item in payload if isinstance(item, Mapping)]
    if isinstance(payload, Mapping):
        for key in ("rows", "data", "factors", "records"):
            value = payload.get(key)
            if isinstance(value, list):
                return [_coerce_row(item) for item in value if isinstance(item, Mapping)]
        return [_coerce_row(payload)]
    return []


def _coerce_row(row: Mapping[str, Any]) -> dict[str, Any]:
    return {str(key): value for key, value in row.items()}


def _collect_columns(rows: Sequence[Mapping[str, Any]]) -> list[str]:
    columns: list[str] = []
    seen: set[str] = set()
    for row in rows:
        for key in row:
            if key not in seen:
                seen.add(key)
                columns.append(key)
    return columns


def _coerce_upload_text(text: str | bytes) -> tuple[bytes, str]:
    if isinstance(text, bytes):
        raw = text
        return raw, raw.decode("utf-8-sig")
    raw = text.encode("utf-8")
    return raw, text.lstrip("\ufeff")


def _guess_format_from_filename(filename: str | None) -> str:
    suffix = (filename or "").rsplit(".", 1)[-1].lower() if filename and "." in filename else ""
    if suffix == "json":
        return "json"
    if suffix == "csv":
        return "csv"
    return "unknown"


def _normalize_token(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")


def _normalize_column(value: str) -> str:
    return _normalize_token(value)


def _row_to_values(row: Mapping[str, Any], columns: Sequence[str]) -> tuple[str, ...]:
    return tuple(str(row.get(column, "")) for column in columns)


def _next_flow_step(completed_steps: Sequence[str]) -> str | None:
    completed = set(completed_steps)
    for step in PUBLIC_FACTOR_IMPORT_JOB_FLOW:
        if step not in completed:
            return step
    return None


def _build_minimal_xlsx(rows: Sequence[Sequence[Any]], *, sheet_name: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as workbook:
        workbook.writestr("[Content_Types].xml", _xlsx_content_types_xml())
        workbook.writestr("_rels/.rels", _xlsx_root_rels_xml())
        workbook.writestr("xl/workbook.xml", _xlsx_workbook_xml(sheet_name))
        workbook.writestr("xl/_rels/workbook.xml.rels", _xlsx_workbook_rels_xml())
        workbook.writestr("xl/styles.xml", _xlsx_styles_xml())
        workbook.writestr("xl/worksheets/sheet1.xml", _xlsx_sheet_xml(rows))
    return buffer.getvalue()


def _xlsx_content_types_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        "</Types>"
    )


def _xlsx_root_rels_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        "</Relationships>"
    )


def _xlsx_workbook_xml(sheet_name: str) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        "<sheets>"
        f'<sheet name="{escape(sheet_name)}" sheetId="1" r:id="rId1"/>'
        "</sheets>"
        "</workbook>"
    )


def _xlsx_workbook_rels_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
        'Target="styles.xml"/>'
        "</Relationships>"
    )


def _xlsx_styles_xml() -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>'
        "</styleSheet>"
    )


def _xlsx_sheet_xml(rows: Sequence[Sequence[Any]]) -> str:
    row_xml = "".join(_xlsx_row_xml(index, row) for index, row in enumerate(rows, start=1))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f"<sheetData>{row_xml}</sheetData>"
        "</worksheet>"
    )


def _xlsx_row_xml(row_index: int, row: Iterable[Any]) -> str:
    cells = "".join(
        _xlsx_inline_string_cell(row_index=row_index, column_index=column_index, value=str(value))
        for column_index, value in enumerate(row, start=1)
    )
    return f'<row r="{row_index}">{cells}</row>'


def _xlsx_inline_string_cell(*, row_index: int, column_index: int, value: str) -> str:
    coordinate = f"{_xlsx_column_name(column_index)}{row_index}"
    return f'<c r="{coordinate}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'


def _xlsx_column_name(column_index: int) -> str:
    name = ""
    index = column_index
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name

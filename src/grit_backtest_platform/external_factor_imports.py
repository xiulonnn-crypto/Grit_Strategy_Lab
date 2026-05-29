"""Pure helpers for public factor import intake.

This module intentionally has no FastAPI, SQLite, pandas, or network
dependencies.  API and storage layers can wrap these helpers later while the
domain contract stays review-gated.
"""

from __future__ import annotations

import csv
import datetime as _dt
import hashlib
import io
import json
import posixpath
import re
import zipfile
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence
from xml.etree import ElementTree as ET
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

FAMA_FRENCH_DATASET_DOWNLOADS: Mapping[str, str] = {
    "fama_french_us_research_factors_daily": (
        "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"
        "F-F_Research_Data_5_Factors_2x3_daily_CSV.zip"
    ),
    "fama_french_us_research_factors_monthly": (
        "https://mba.tuck.dartmouth.edu/pages/faculty/ken.french/ftp/"
        "F-F_Research_Data_5_Factors_2x3_CSV.zip"
    ),
}

AQR_DATASET_DOWNLOADS: Mapping[str, str] = {
    "aqr_public_style_factors": (
        "https://www.aqr.com/-/media/AQR/Documents/Insights/Data-Sets/"
        "Quality-Minus-Junk-Factors-Daily.xlsx"
    ),
}

AQR_QMJ_SHEET_NAME = "QMJ Factors"

FAMA_FRENCH_FACTOR_NAMES: Mapping[str, str] = {
    "Mkt-RF": "Market excess return",
    "SMB": "Size factor",
    "HML": "Value factor",
    "RMW": "Profitability factor",
    "CMA": "Investment factor",
    "RF": "Risk-free rate",
}

FIELD_ALIASES: Mapping[str, tuple[str, ...]] = {
    "date": ("date", "as_of", "month", "period", "observation_date", "trade_date"),
    "factor_id": ("factor_id", "factor", "factor_code", "code", "signal_id", "name"),
    "factor_name": ("factor_name", "factor_label", "label", "description", "long_name"),
    "zoo": ("zoo", "alpha_zoo", "library", "catalog"),
    "formula": ("formula", "expression", "dsl", "alpha_formula"),
    "rank_ic": ("rank_ic", "ic", "mean_ic", "bench_ic"),
    "bench_classification": ("bench_classification", "classification", "bench_status", "alive_status"),
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
        status="available",
        license_mode="public_research/license_required",
        intake_policy="download_or_manual_upload_review",
        datasets=(
            PublicFactorSourceDataset(
                dataset_id="aqr_public_style_factors",
                label="AQR style and alternative factors",
                frequency="daily",
                availability="license/public_dataset",
                allowed_intake_modes=("manual_upload", "reviewed_import"),
                review_notes=(
                    "Uses the public AQR Quality Minus Junk daily workbook; operator must keep source/license citation.",
                ),
            ),
        ),
        notes=("AQR QMJ daily can be pulled from the public workbook and remains review-gated before admission.",),
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
    PublicFactorSource(
        source_id="vibe_alpha_zoo",
        label="Vibe Alpha Zoo",
        status="available",
        license_mode="open_source_catalog",
        intake_policy="catalog_manifest_raw_f2_only",
        datasets=(
            PublicFactorSourceDataset(
                dataset_id="vibe_qlib158",
                label="Vibe Qlib 158 Alpha catalog",
                frequency="mixed",
                availability="open_source_catalog",
                allowed_intake_modes=("manual_upload", "reviewed_import"),
                review_notes=("Formula catalog only; supported rows enter Raw_F2 and must pass WNZT before D2.",),
            ),
            PublicFactorSourceDataset(
                dataset_id="vibe_alpha101",
                label="Vibe Alpha101 catalog",
                frequency="mixed",
                availability="open_source_catalog",
                allowed_intake_modes=("manual_upload", "reviewed_import"),
                review_notes=("Formula catalog only; no direct factor-library writes.",),
            ),
            PublicFactorSourceDataset(
                dataset_id="vibe_gtja191",
                label="Vibe GTJA 191 catalog",
                frequency="mixed",
                availability="open_source_catalog",
                allowed_intake_modes=("manual_upload", "reviewed_import"),
                review_notes=("AST scan and bench classification are required before Raw_F2 staging.",),
            ),
            PublicFactorSourceDataset(
                dataset_id="vibe_academic",
                label="Vibe academic Alpha catalog",
                frequency="mixed",
                availability="open_source_catalog",
                allowed_intake_modes=("manual_upload", "reviewed_import"),
                review_notes=("Unsupported formulas remain blocked catalog evidence.",),
            ),
        ),
        notes=(
            "Inspired by HKUDS/Vibe-Trading Alpha Zoo catalog and bench flow.",
            "Never writes directly to factor_definitions; only Raw_F2 candidates are staged.",
        ),
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


def fama_french_dataset_download_url(dataset_key: str) -> str | None:
    return FAMA_FRENCH_DATASET_DOWNLOADS.get(str(dataset_key or "").strip())


def aqr_dataset_download_url(dataset_key: str) -> str | None:
    return AQR_DATASET_DOWNLOADS.get(str(dataset_key or "").strip())


def normalize_aqr_dataset_xlsx(content: bytes, *, dataset_key: str) -> str:
    if str(dataset_key or "").strip() != "aqr_public_style_factors":
        raise ValueError(f"AQR automatic normalization is not configured for dataset: {dataset_key}")
    rows = _parse_aqr_qmj_daily_rows(content, dataset_key=dataset_key)
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=TEMPLATE_COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


def normalize_fama_french_dataset_zip(content: bytes, *, dataset_key: str) -> str:
    with zipfile.ZipFile(io.BytesIO(content), "r") as archive:
        names = [
            name
            for name in archive.namelist()
            if name.lower().endswith((".csv", ".txt"))
        ]
        if not names:
            raise ValueError("Fama-French archive does not contain a CSV/TXT payload")
        raw = archive.read(names[0])
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            decoded = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        decoded = raw.decode("utf-8", errors="replace")
    return normalize_fama_french_dataset_text(decoded, dataset_key=dataset_key)


def normalize_fama_french_dataset_text(text: str, *, dataset_key: str) -> str:
    rows = _parse_fama_french_rows(text, dataset_key=dataset_key)
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=TEMPLATE_COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue()


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


VIBE_ALPHA_ZOO_SOURCE_URL = "https://github.com/HKUDS/Vibe-Trading"
VIBE_ALPHA_ZOO_PARSER_VERSION = "vibe_alpha_zoo_manifest_v1"
VIBE_ALPHA_ZOO_SUPPORTED_ZOOS = {"qlib158", "alpha101", "gtja191", "academic"}
VIBE_ALLOWED_FUNCTIONS = {
    "Abs",
    "Correlation",
    "Lag",
    "Log",
    "Max",
    "Mean",
    "Min",
    "Neutralize",
    "Rank",
    "Residual",
    "Return",
    "Std",
    "TS_Rank",
    "TS_Return",
    "TsRank",
    "Winsorize",
    "ZScore",
}
VIBE_FORBIDDEN_FORMULA_PATTERNS = (
    "__",
    "import",
    "eval",
    "exec",
    "open(",
    "read(",
    "write(",
    "to_csv",
    "to_pickle",
    "os.",
    "sys.",
    "subprocess",
    ";",
)


def analyze_vibe_alpha_zoo_manifest_text(
    text: str | bytes,
    *,
    filename: str | None = None,
    dataset_key: str = "vibe_alpha_zoo",
    min_rank_ic: float = 0.02,
) -> dict[str, Any]:
    raw_bytes, decoded = _coerce_upload_text(text)
    parsed_format, rows, columns = _parse_upload_rows(decoded, filename=filename)
    normalized_rows = [
        _normalize_vibe_alpha_row(row, dataset_key=dataset_key, index=index, min_rank_ic=min_rank_ic)
        for index, row in enumerate(rows, start=1)
        if isinstance(row, Mapping)
    ]
    supported_rows = [row for row in normalized_rows if row["ast_status"] == "PASS"]
    blocked_rows = [row for row in normalized_rows if row["ast_status"] != "PASS"]
    classification_counts = _count_vibe_values(row["bench_classification"] for row in normalized_rows)
    zoo_counts = _count_vibe_values(row["zoo"] for row in normalized_rows)
    formulas_hash = hashlib.sha256(
        json.dumps(
            [
                {
                    "zoo": row["zoo"],
                    "alpha_id": row["alpha_id"],
                    "formula": row["formula"],
                    "formula_hash": row["formula_hash"],
                }
                for row in normalized_rows
            ],
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
    ).hexdigest()
    return {
        "schema_version": PUBLIC_FACTOR_IMPORT_SCHEMA_VERSION,
        "filename": filename or "",
        "format": parsed_format,
        "sha256": hashlib.sha256(raw_bytes).hexdigest(),
        "row_count": len(normalized_rows),
        "columns": columns,
        "sample_rows": [dict(row) for row in normalized_rows[:5]],
        "field_mapping_suggestions": suggest_public_factor_field_mapping(columns),
        "catalog_manifest": {
            "source": "HKUDS/Vibe-Trading",
            "source_url": VIBE_ALPHA_ZOO_SOURCE_URL,
            "dataset_key": dataset_key,
            "parser_version": VIBE_ALPHA_ZOO_PARSER_VERSION,
            "formula_count": len(normalized_rows),
            "supported_formula_count": len(supported_rows),
            "blocked_formula_count": len(blocked_rows),
            "zoo_counts": zoo_counts,
            "formula_hash": formulas_hash,
            "ast_scan": {
                "status": "PASS" if supported_rows and not blocked_rows else ("WARN" if supported_rows else "BLOCKED"),
                "passed_count": len(supported_rows),
                "blocked_count": len(blocked_rows),
                "blocked_reasons": _count_vibe_values(
                    reason
                    for row in blocked_rows
                    for reason in row.get("ast_reasons", [])
                ),
            },
            "normalized_formulas": normalized_rows,
        },
        "bench_summary": {
            "method": "vibe_alpha_zoo_rank_ic_manifest_v1",
            "threshold": min_rank_ic,
            "alive_count": int(classification_counts.get("alive", 0)),
            "reversed_count": int(classification_counts.get("reversed", 0)),
            "dead_count": int(classification_counts.get("dead", 0)),
            "unbenchable_count": int(classification_counts.get("unbenchable", 0)),
            "classification_counts": classification_counts,
        },
        "precheck": {
            "status": "PRECHECK_READY" if supported_rows else "NEEDS_MAPPING",
            "review_gate": PUBLIC_FACTOR_IMPORT_INITIAL_REVIEW_STATE,
            "can_publish": False,
            "direct_publish_allowed": False,
            "parsed_format": parsed_format,
            "sha256": hashlib.sha256(raw_bytes).hexdigest(),
            "row_count": len(normalized_rows),
            "columns": columns,
            "sample_rows": [dict(row) for row in normalized_rows[:5]],
            "field_mapping_suggestions": suggest_public_factor_field_mapping(columns),
            "missing_required_fields": [] if supported_rows else ["formula"],
            "required_next_steps": ["catalog_ast_review", "raw_f2_staging"],
        },
    }


def _normalize_vibe_alpha_row(
    row: Mapping[str, Any],
    *,
    dataset_key: str,
    index: int,
    min_rank_ic: float,
) -> dict[str, Any]:
    lookup = {_normalize_column(key): value for key, value in row.items()}

    def pick(*keys: str) -> str:
        for key in keys:
            value = lookup.get(_normalize_column(key))
            if value is not None and str(value).strip():
                return str(value).strip()
        return ""

    zoo = pick("zoo", "alpha_zoo", "library", "catalog") or _zoo_from_vibe_dataset_key(dataset_key)
    alpha_id = pick("alpha_id", "factor_id", "id", "name") or f"{zoo}_{index:03d}"
    formula = pick("formula", "expression", "dsl", "alpha_formula")
    formula_name = pick("formula_name", "factor_name", "name", "description") or alpha_id
    rank_ic = _coerce_vibe_float(pick("rank_ic", "ic", "mean_ic", "bench_ic"))
    classification = _classify_vibe_alpha(
        pick("bench_classification", "classification", "bench_status", "alive_status"),
        rank_ic=rank_ic,
        min_rank_ic=min_rank_ic,
    )
    scan = _scan_vibe_formula(formula)
    formula_hash = hashlib.sha256(formula.encode("utf-8")).hexdigest()[:16] if formula else ""
    return {
        "zoo": _normalize_factor_token(zoo),
        "alpha_id": _normalize_factor_token(alpha_id),
        "formula_name": formula_name,
        "formula": formula,
        "formula_hash": formula_hash,
        "ast_status": scan["status"],
        "ast_reasons": scan["reasons"],
        "ast_functions": scan["functions"],
        "rank_ic": rank_ic,
        "bench_classification": classification,
        "theme": pick("theme", "family", "category") or "alpha_zoo",
        "universe": pick("universe", "market") or "US_EQUITY",
        "notes": pick("notes", "note"),
    }


def _scan_vibe_formula(formula: str) -> dict[str, Any]:
    text = str(formula or "").strip()
    reasons: list[str] = []
    if not text:
        reasons.append("formula_missing")
    lowered = text.lower()
    for pattern in VIBE_FORBIDDEN_FORMULA_PATTERNS:
        if pattern in lowered:
            reasons.append(f"forbidden_token:{pattern}")
    functions = sorted(set(re.findall(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(", text)))
    unknown_functions = [function for function in functions if function not in VIBE_ALLOWED_FUNCTIONS]
    if unknown_functions:
        reasons.extend(f"unsupported_function:{function}" for function in unknown_functions)
    if text.count("(") != text.count(")"):
        reasons.append("unbalanced_parentheses")
    if len(text) > 500:
        reasons.append("formula_too_long")
    return {
        "status": "PASS" if not reasons else "BLOCKED",
        "reasons": reasons,
        "functions": functions,
    }


def _classify_vibe_alpha(value: str, *, rank_ic: float | None, min_rank_ic: float) -> str:
    normalized = _normalize_factor_token(value)
    if normalized in {"alive", "reversed", "dead", "unbenchable"}:
        return normalized
    if rank_ic is None:
        return "unbenchable"
    if rank_ic >= min_rank_ic:
        return "alive"
    if rank_ic <= -min_rank_ic:
        return "reversed"
    return "dead"


def _zoo_from_vibe_dataset_key(dataset_key: str) -> str:
    normalized = str(dataset_key or "").lower()
    for zoo in VIBE_ALPHA_ZOO_SUPPORTED_ZOOS:
        if zoo in normalized:
            return zoo
    return "alpha_zoo"


def _coerce_vibe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _count_vibe_values(values: Iterable[Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        key = _normalize_factor_token(str(value or "")) or "unknown"
        counts[key] = counts.get(key, 0) + 1
    return counts


def _parse_aqr_qmj_daily_rows(content: bytes, *, dataset_key: str) -> list[dict[str, str]]:
    headers: list[str] | None = None
    normalized_rows: list[dict[str, str]] = []
    for row in _iter_xlsx_sheet_rows(content, sheet_name=AQR_QMJ_SHEET_NAME):
        cells = [str(cell or "").strip() for cell in row]
        if not any(cells):
            if headers and normalized_rows:
                break
            continue
        first = cells[0].lstrip("\ufeff").strip()
        if headers is None:
            if first.upper() == "DATE" and any(cell for cell in cells[1:]):
                headers = ["DATE", *cells[1:]]
            continue
        date_value = _normalize_aqr_date(first)
        if not date_value:
            if normalized_rows:
                break
            continue
        for index, region in enumerate(headers[1:], start=1):
            if not region or index >= len(cells):
                continue
            raw_value = cells[index]
            if raw_value == "":
                continue
            try:
                value = float(raw_value)
            except ValueError:
                continue
            region_label = str(region).strip()
            normalized_rows.append(
                {
                    "date": date_value,
                    "factor_id": f"aqr_qmj_{_normalize_factor_token(region_label)}",
                    "factor_name": f"AQR Quality Minus Junk {region_label}",
                    "symbol": region_label,
                    "value": f"{value:.12g}",
                    "frequency": "daily",
                    "source_dataset": dataset_key,
                    "region": region_label,
                    "notes": "AQR Quality Minus Junk daily workbook",
                }
            )
    if not normalized_rows:
        raise ValueError("AQR QMJ workbook did not contain parseable daily factor rows")
    return normalized_rows


def _iter_xlsx_sheet_rows(content: bytes, *, sheet_name: str) -> Iterable[list[str]]:
    with zipfile.ZipFile(io.BytesIO(content), "r") as workbook:
        shared_strings = _xlsx_shared_strings(workbook)
        sheet_path = _xlsx_sheet_path(workbook, sheet_name=sheet_name)
        with workbook.open(sheet_path) as handle:
            for _event, row_element in ET.iterparse(handle, events=("end",)):
                if _strip_xml_namespace(row_element.tag) != "row":
                    continue
                values_by_column: dict[int, str] = {}
                for cell in row_element:
                    if _strip_xml_namespace(cell.tag) != "c":
                        continue
                    ref = str(cell.attrib.get("r") or "")
                    column_index = _xlsx_column_index(ref)
                    if column_index <= 0:
                        continue
                    values_by_column[column_index] = _xlsx_cell_text(cell, shared_strings)
                if values_by_column:
                    max_column = max(values_by_column)
                    yield [values_by_column.get(index, "") for index in range(1, max_column + 1)]
                else:
                    yield []
                row_element.clear()


def _xlsx_shared_strings(workbook: zipfile.ZipFile) -> list[str]:
    if "xl/sharedStrings.xml" not in workbook.namelist():
        return []
    root = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
    strings: list[str] = []
    for item in root:
        if _strip_xml_namespace(item.tag) != "si":
            continue
        parts = [
            text_node.text or ""
            for text_node in item.iter()
            if _strip_xml_namespace(text_node.tag) == "t"
        ]
        strings.append("".join(parts))
    return strings


def _xlsx_sheet_path(workbook: zipfile.ZipFile, *, sheet_name: str) -> str:
    workbook_root = ET.fromstring(workbook.read("xl/workbook.xml"))
    rel_id = ""
    for sheet in workbook_root.iter():
        if _strip_xml_namespace(sheet.tag) != "sheet":
            continue
        if str(sheet.attrib.get("name") or "") == sheet_name:
            rel_id = str(sheet.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id") or "")
            break
    if not rel_id:
        return "xl/worksheets/sheet1.xml"
    rel_root = ET.fromstring(workbook.read("xl/_rels/workbook.xml.rels"))
    for rel in rel_root:
        if str(rel.attrib.get("Id") or "") != rel_id:
            continue
        target = str(rel.attrib.get("Target") or "worksheets/sheet1.xml")
        if target.startswith("/"):
            return target.lstrip("/")
        return posixpath.normpath(posixpath.join("xl", target))
    return "xl/worksheets/sheet1.xml"


def _xlsx_cell_text(cell: ET.Element, shared_strings: Sequence[str]) -> str:
    cell_type = str(cell.attrib.get("t") or "")
    if cell_type == "inlineStr":
        return "".join(
            text_node.text or ""
            for text_node in cell.iter()
            if _strip_xml_namespace(text_node.tag) == "t"
        )
    value_node = next((child for child in cell if _strip_xml_namespace(child.tag) == "v"), None)
    value = value_node.text if value_node is not None else ""
    if cell_type == "s":
        try:
            return shared_strings[int(value or "0")]
        except (IndexError, ValueError):
            return ""
    return str(value or "")


def _xlsx_column_index(ref: str) -> int:
    letters = re.match(r"([A-Z]+)", ref.upper())
    if not letters:
        return 0
    index = 0
    for char in letters.group(1):
        index = index * 26 + (ord(char) - ord("A") + 1)
    return index


def _strip_xml_namespace(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _normalize_aqr_date(value: str) -> str:
    cleaned = str(value or "").strip()
    if not cleaned:
        return ""
    for fmt in ("%m/%d/%Y", "%Y-%m-%d", "%m/%d/%y"):
        try:
            return _dt.datetime.strptime(cleaned, fmt).date().isoformat()
        except ValueError:
            continue
    if cleaned.replace(".", "", 1).isdigit():
        try:
            serial = float(cleaned)
        except ValueError:
            return ""
        # Excel's Windows date system uses 1899-12-30 as the serial-day origin.
        return (_dt.date(1899, 12, 30) + _dt.timedelta(days=int(serial))).isoformat()
    return ""


def _normalize_factor_token(value: str) -> str:
    token = re.sub(r"[^a-zA-Z0-9]+", "_", str(value or "").strip().lower()).strip("_")
    return token or "global"


def _parse_fama_french_rows(text: str, *, dataset_key: str) -> list[dict[str, str]]:
    parsed = csv.reader(io.StringIO(text))
    headers: list[str] | None = None
    normalized_rows: list[dict[str, str]] = []
    frequency = "daily" if "daily" in str(dataset_key).lower() else "monthly"
    for raw_row in parsed:
        row = [str(cell or "").strip() for cell in raw_row]
        if not any(row):
            if headers and normalized_rows:
                break
            continue
        first = row[0].lstrip("\ufeff")
        if headers is None:
            factor_headers = [cell for cell in row[1:] if cell]
            if factor_headers and any(cell in FAMA_FRENCH_FACTOR_NAMES for cell in factor_headers):
                headers = ["date", *factor_headers]
            continue
        if not first.isdigit() or len(first) not in {6, 8}:
            if normalized_rows:
                break
            continue
        date_value = _normalize_fama_french_date(first)
        for index, factor_id in enumerate(headers[1:], start=1):
            if index >= len(row):
                continue
            raw_value = row[index].strip()
            if raw_value in {"", "-99.99", "-999", "-999.0"}:
                continue
            try:
                value = float(raw_value) / 100.0
            except ValueError:
                continue
            normalized_rows.append(
                {
                    "date": date_value,
                    "factor_id": _normalize_fama_french_factor_id(factor_id),
                    "factor_name": FAMA_FRENCH_FACTOR_NAMES.get(factor_id, factor_id),
                    "symbol": "",
                    "value": f"{value:.8f}".rstrip("0").rstrip("."),
                    "frequency": frequency,
                    "source_dataset": dataset_key,
                    "region": "US",
                    "notes": "Kenneth French Data Library auto download",
                }
            )
    if not normalized_rows:
        raise ValueError("Fama-French payload did not contain parseable factor rows")
    return normalized_rows


def _normalize_fama_french_date(value: str) -> str:
    if len(value) == 8:
        return f"{value[:4]}-{value[4:6]}-{value[6:8]}"
    return f"{value[:4]}-{value[4:6]}-01"


def _normalize_fama_french_factor_id(value: str) -> str:
    return "ff_" + _normalize_token(value.replace("-", "_"))


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

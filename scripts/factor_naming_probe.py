from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def _loads(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except Exception:
        return default


def _json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _first_text(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def _fetch_json(url: str, *, timeout: float) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read().decode("utf-8")
            payload = json.loads(body)
        return {"ok": True, "status_code": response.status, "url": url, "payload": payload}
    except urllib.error.HTTPError as exc:
        return {"ok": False, "status_code": exc.code, "url": url, "error": str(exc)}
    except Exception as exc:
        return {"ok": False, "status_code": None, "url": url, "error": str(exc)}


def _find_factor_item(items: Any, factor_id: str) -> dict[str, Any] | None:
    if not isinstance(items, list):
        return None
    for item in items:
        if isinstance(item, dict) and str(item.get("id") or item.get("factor_id") or "").strip() == factor_id:
            return item
    return None


def _find_factory_matches(payload: Any, factor_id: str) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    matches: list[dict[str, Any]] = []
    for key in ("publishable_factors", "external_import_quarantine", "quarantine_rows"):
        value = payload.get(key)
        rows = value.get("items") if isinstance(value, dict) else value
        if not isinstance(rows, list):
            continue
        for row in rows:
            if not isinstance(row, dict):
                continue
            if (
                str(row.get("factor_id") or "").strip() == factor_id
                or str(row.get("target_factor_id") or "").strip() == factor_id
                or factor_id in _json_text(row)
            ):
                item = dict(row)
                item["_factory_section"] = key
                matches.append(item)
    return matches


def _name_projection(surface: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(surface, dict):
        return {}
    audit = surface.get("name_audit") if isinstance(surface.get("name_audit"), dict) else {}
    components = audit.get("structured_components") if isinstance(audit.get("structured_components"), dict) else {}
    return {
        "name": surface.get("name"),
        "display_name_cn": surface.get("display_name_cn"),
        "base_display_name_cn": surface.get("base_display_name_cn"),
        "compact_display_name_cn": surface.get("compact_display_name_cn"),
        "name_schema_version": surface.get("name_schema_version"),
        "naming_protocol_version": surface.get("naming_protocol_version")
        or surface.get("name_protocol_version"),
        "style_family": components.get("style_family"),
        "core_semantic": components.get("core_semantic"),
        "governance_tag": components.get("governance_tag"),
        "name_collision_key": surface.get("name_collision_key") or audit.get("name_collision_key"),
        "name_dedupe_suffix": surface.get("name_dedupe_suffix") or audit.get("name_dedupe_suffix"),
    }


def _db_surface(db_path: Path, factor_id: str) -> dict[str, Any]:
    if not db_path.exists():
        return {"ok": False, "error": f"db_not_found:{db_path}", "path": str(db_path)}
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            "SELECT * FROM factor_definitions WHERE id = ? AND deleted_at IS NULL",
            (factor_id,),
        ).fetchone()
        if row is None:
            return {"ok": False, "error": "factor_not_found", "path": str(db_path)}
        version_rows = conn.execute(
            """
            SELECT *
            FROM factor_versions
            WHERE factor_id = ?
            ORDER BY version DESC
            """,
            (factor_id,),
        ).fetchall()
        lineage_rows = conn.execute(
            """
            SELECT source_type, source_id, relation_type, metadata_json, created_at
            FROM factor_lineage_edges
            WHERE target_type = 'factor' AND target_id = ?
            ORDER BY created_at ASC, source_type ASC, source_id ASC
            """,
            (factor_id,),
        ).fetchall()
    finally:
        conn.close()

    latest_metadata = _loads(version_rows[0]["metadata_json"], {}) if version_rows else {}
    publish_metadata = latest_metadata.get("publish_metadata") if isinstance(latest_metadata, dict) else {}
    if not isinstance(publish_metadata, dict):
        publish_metadata = {}
    name_audit = publish_metadata.get("name_audit") if isinstance(publish_metadata.get("name_audit"), dict) else {}
    return {
        "ok": True,
        "path": str(db_path),
        "factor": {
            "id": row["id"],
            "stored_name": row["name"],
            "source": row["source"],
            "lifecycle_status": row["lifecycle_status"],
            "diagnostic_status": row["diagnostic_status"],
            "frequency": row["frequency"],
            "expression": row["expression"],
        },
        "latest_version": {
            "id": version_rows[0]["id"] if version_rows else None,
            "version": version_rows[0]["version"] if version_rows else None,
            "status": version_rows[0]["status"] if version_rows else None,
            "publish_naming_rule": latest_metadata.get("publish_naming_rule") if isinstance(latest_metadata, dict) else None,
            "publish_metadata_display_name_cn": publish_metadata.get("display_name_cn"),
            "publish_metadata_base_display_name_cn": publish_metadata.get("base_display_name_cn"),
            "publish_metadata_name_audit": name_audit,
        },
        "lineage": [dict(item) for item in lineage_rows],
    }


def _surface_names(probe: dict[str, Any]) -> dict[str, str]:
    db_factor = probe.get("db", {}).get("factor") if isinstance(probe.get("db"), dict) else {}
    latest = probe.get("db", {}).get("latest_version") if isinstance(probe.get("db"), dict) else {}
    factory = probe.get("factory_overview", {}).get("matched_projection")
    listing = probe.get("factor_list", {}).get("matched_projection")
    detail = probe.get("factor_detail", {}).get("projection")
    return {
        "db.stored_name": _first_text(db_factor.get("stored_name") if isinstance(db_factor, dict) else None),
        "db.publish_metadata_display_name_cn": _first_text(
            latest.get("publish_metadata_display_name_cn") if isinstance(latest, dict) else None
        ),
        "factory.display_name_cn": _first_text(factory.get("display_name_cn") if isinstance(factory, dict) else None),
        "list.display_name_cn": _first_text(listing.get("display_name_cn") if isinstance(listing, dict) else None),
        "detail.display_name_cn": _first_text(detail.get("display_name_cn") if isinstance(detail, dict) else None),
    }


def probe_factor_naming(
    *,
    factor_id: str,
    db_path: Path,
    api_base: str,
    timeout: float,
    skip_api: bool = False,
) -> dict[str, Any]:
    factor_id = str(factor_id or "").strip()
    api_base = str(api_base or "").rstrip("/")
    encoded_id = urllib.parse.quote(factor_id, safe="")
    probe: dict[str, Any] = {
        "schema": "grit.factor_naming_probe.v1",
        "factor_id": factor_id,
        "db": _db_surface(db_path, factor_id),
    }
    if skip_api:
        probe["api"] = {"skipped": True}
        return probe

    overview_result = _fetch_json(f"{api_base}/factor-factory/overview", timeout=timeout)
    list_result = _fetch_json(f"{api_base}/factors?lifecycle=all", timeout=timeout)
    detail_result = _fetch_json(f"{api_base}/factors/{encoded_id}", timeout=timeout)

    factory_matches = _find_factory_matches(overview_result.get("payload"), factor_id) if overview_result.get("ok") else []
    list_match = _find_factor_item((list_result.get("payload") or {}).get("items"), factor_id) if list_result.get("ok") else None
    detail_payload = detail_result.get("payload") if detail_result.get("ok") and isinstance(detail_result.get("payload"), dict) else None

    probe["factory_overview"] = {
        "ok": overview_result.get("ok"),
        "status_code": overview_result.get("status_code"),
        "error": overview_result.get("error"),
        "match_count": len(factory_matches),
        "matches": [_name_projection(item) | {"candidate_id": item.get("candidate_id") or item.get("id"), "section": item.get("_factory_section")} for item in factory_matches],
        "matched_projection": _name_projection(factory_matches[0]) if factory_matches else {},
    }
    probe["factor_list"] = {
        "ok": list_result.get("ok"),
        "status_code": list_result.get("status_code"),
        "error": list_result.get("error"),
        "matched": bool(list_match),
        "matched_projection": _name_projection(list_match),
    }
    probe["factor_detail"] = {
        "ok": detail_result.get("ok"),
        "status_code": detail_result.get("status_code"),
        "error": detail_result.get("error"),
        "projection": _name_projection(detail_payload),
    }
    return probe


def _acceptance_surface_keys(acceptance_surface: str) -> set[str]:
    if acceptance_surface == "factory":
        return {"factory.display_name_cn"}
    return set()


def analyze_probe(
    probe: dict[str, Any],
    *,
    expected_name: str = "",
    reject_name: str = "",
    acceptance_surface: str = "all",
) -> list[str]:
    warnings: list[str] = []
    names = _surface_names(probe)
    scoped_keys = _acceptance_surface_keys(acceptance_surface)
    scoped_names = {key: value for key, value in names.items() if not scoped_keys or key in scoped_keys}
    non_empty = {key: value for key, value in scoped_names.items() if value}
    if expected_name:
        for key, value in non_empty.items():
            if value != expected_name:
                warnings.append(f"name_mismatch:{key}")
        if scoped_keys:
            for key in sorted(scoped_keys):
                if not names.get(key):
                    warnings.append(f"acceptance_surface_missing:{key}")
    comparable = {
        key: value
        for key, value in non_empty.items()
        if not key.startswith("factory.") or value
    }
    if not expected_name and len(set(comparable.values())) > 1:
        warnings.append("surface_name_divergence")
    if reject_name:
        for key, value in non_empty.items():
            if reject_name in value:
                warnings.append(f"rejected_name_present:{key}")
    api_scope = ("factory_overview",) if acceptance_surface == "factory" else ("factory_overview", "factor_list", "factor_detail")
    for key in api_scope:
        surface = probe.get(key)
        if isinstance(surface, dict) and surface.get("ok") is False:
            warnings.append(f"api_surface_unavailable:{key}")
    if acceptance_surface == "all" and isinstance(probe.get("db"), dict) and probe["db"].get("ok") is False:
        warnings.append("db_surface_unavailable")
    return sorted(set(warnings))


def write_trace_matrix(
    path: Path,
    *,
    probe: dict[str, Any],
    warnings: list[str],
    expected_name: str,
    reject_name: str,
    acceptance_surface: str,
) -> None:
    names = _surface_names(probe)
    scoped_keys = _acceptance_surface_keys(acceptance_surface)

    def row_status(surface_key: str, present_status: str, missing_status: str) -> str:
        if scoped_keys and surface_key not in scoped_keys:
            return "OUT_OF_SCOPE"
        return present_status if names.get(surface_key) else missing_status

    rows = [
        (
            "DB stored name",
            names.get("db.stored_name") or "",
            row_status("db.stored_name", "PASS", "BLOCKED"),
        ),
        (
            "DB publish metadata name",
            names.get("db.publish_metadata_display_name_cn") or "",
            row_status("db.publish_metadata_display_name_cn", "PASS", "NOT_CHECKED"),
        ),
        (
            "Factory overview publishable/quarantine name",
            names.get("factory.display_name_cn") or "",
            row_status("factory.display_name_cn", "PASS", "BLOCKED"),
        ),
        (
            "Factor list API name",
            names.get("list.display_name_cn") or "",
            row_status("list.display_name_cn", "PASS", "BLOCKED"),
        ),
        (
            "Factor detail API name",
            names.get("detail.display_name_cn") or "",
            row_status("detail.display_name_cn", "PASS", "BLOCKED"),
        ),
    ]
    if expected_name:
        rows.append(("Expected name gate", expected_name, "FAIL" if any("name_mismatch:" in item for item in warnings) else "PASS"))
    if reject_name:
        rows.append(("Rejected name gate", reject_name, "FAIL" if any("rejected_name_present:" in item for item in warnings) else "PASS"))
    status_counts = {
        status: sum(1 for _, _, row_status_value in rows if row_status_value == status)
        for status in ("PASS", "FAIL", "BLOCKED", "NOT_CHECKED", "OUT_OF_SCOPE")
    }
    lines = [
        "# Factor Naming Probe Trace Matrix",
        "",
        f"- Factor ID: `{probe.get('factor_id')}`",
        f"- Acceptance surface: `{acceptance_surface}`",
        f"- Expected name: `{expected_name or '(not supplied)'}`",
        f"- Rejected name: `{reject_name or '(not supplied)'}`",
        f"- Warnings: `{', '.join(warnings) if warnings else 'none'}`",
        "",
        "| Gate | Value | Status |",
        "| --- | --- | --- |",
    ]
    for gate, value, status in rows:
        safe_value = str(value).replace("|", "\\|") or "(empty)"
        lines.append(f"| {gate} | `{safe_value}` | {status} |")
    lines.extend(
        [
            "",
            "Result: "
            + ", ".join(f"{key}={value}" for key, value in status_counts.items())
            + ".",
        ]
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="Read-only factor naming probe across DB, factory, list, and detail surfaces.")
    parser.add_argument("--factor-id", required=True)
    parser.add_argument("--db", default=os.environ.get("GRIT_BACKTEST_DB") or ".grit_backtest_platform.sqlite3")
    parser.add_argument("--api-base", default=os.environ.get("GRIT_API_BASE") or "http://127.0.0.1:8000")
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--skip-api", action="store_true")
    parser.add_argument("--expected-name", default="")
    parser.add_argument("--reject-name", default="")
    parser.add_argument(
        "--acceptance-surface",
        choices=("all", "factory"),
        default="all",
        help="Use 'factory' for not-yet-published Factor Factory candidates where DB/list/detail are expected to be absent.",
    )
    parser.add_argument("--out", default="")
    parser.add_argument("--trace-matrix", default="")
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args()

    db_path = Path(args.db)
    if not db_path.is_absolute():
        db_path = Path.cwd() / db_path
    probe = probe_factor_naming(
        factor_id=args.factor_id,
        db_path=db_path,
        api_base=args.api_base,
        timeout=args.timeout,
        skip_api=args.skip_api,
    )
    warnings = analyze_probe(
        probe,
        expected_name=args.expected_name,
        reject_name=args.reject_name,
        acceptance_surface=args.acceptance_surface,
    )
    probe["acceptance_surface"] = args.acceptance_surface
    probe["warnings"] = warnings
    probe["status"] = "WARN" if warnings else "OK"

    if args.out:
        out_path = Path(args.out)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(probe, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    if args.trace_matrix:
        write_trace_matrix(
            Path(args.trace_matrix),
            probe=probe,
            warnings=warnings,
            expected_name=args.expected_name,
            reject_name=args.reject_name,
            acceptance_surface=args.acceptance_surface,
        )
    print(json.dumps(probe, ensure_ascii=False, indent=2, sort_keys=True))
    return 2 if args.strict and warnings else 0


if __name__ == "__main__":
    sys.exit(main())

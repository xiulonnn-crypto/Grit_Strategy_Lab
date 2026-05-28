from __future__ import annotations

import hashlib
import json
import math
from typing import Any, Mapping, Sequence

REQUIRED_MANIFEST_FIELDS = (
    "job_id",
    "source_job_id",
    "formula_count",
    "refined_count",
    "hash",
    "created_at",
)

BLOCKING_WARNING_PREFIXES = (
    "source_job_id_missing",
    "artifact_manifest_missing",
    "manifest_missing:",
    "manifest_source_job_mismatch",
    "ledger_count_mismatch_",
    "manifest_formula_count_mismatch_raw_total",
    "manifest_refined_count_mismatch_refined_total",
)


def _loads(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(value)
    except Exception:
        return default


def _int(value: Any, default: int = 0) -> int:
    try:
        if value in (None, ""):
            return default
        return int(float(value))
    except (TypeError, ValueError):
        return default


def _mapping_value(row: Mapping[str, Any], key: str, default: Any = None) -> Any:
    try:
        return row.get(key, default)
    except AttributeError:
        try:
            return row[key]  # type: ignore[index]
        except Exception:
            return default


def _candidate_metrics(row: Mapping[str, Any]) -> Mapping[str, Any]:
    metrics = _mapping_value(row, "candidate_metrics")
    if isinstance(metrics, Mapping):
        return metrics
    return _loads(_mapping_value(row, "candidate_metrics_json"), {})


def _count_bool(rows: Sequence[Mapping[str, Any]], key: str) -> int:
    return sum(1 for row in rows if bool(_candidate_metrics(row).get(key)))


def _source_factor_count(rows: Sequence[Mapping[str, Any]]) -> int:
    source_ids: set[str] = set()
    for row in rows:
        metrics = _candidate_metrics(row)
        for source_id in metrics.get("source_factor_ids") or []:
            text = str(source_id).strip()
            if text:
                source_ids.add(text)
    return len(source_ids)


def _ledger_source_factor_count(candidates: Sequence[Mapping[str, Any]]) -> int:
    source_ids: set[str] = set()
    for candidate in candidates:
        for source_id in candidate.get("source_factor_ids") or []:
            text = str(source_id).strip()
            if text:
                source_ids.add(text)
    return len(source_ids)


def _status_counts(rows: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        status = str(_mapping_value(row, "status", "UNKNOWN") or "UNKNOWN")
        counts[status] = counts.get(status, 0) + 1
    return counts


def validate_factor_factory_artifact_manifest(manifest_payload: Mapping[str, Any]) -> list[str]:
    return [key for key in REQUIRED_MANIFEST_FIELDS if manifest_payload.get(key) in (None, "")]


def build_factor_factory_artifact_manifest(
    *,
    run_id: str,
    job_id: str | None,
    source_job_id: str | None,
    formula_count: int,
    refined_count: int,
    created_at: str | None,
    hash_payload: Mapping[str, Any] | None = None,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    stable_hash_payload = dict(hash_payload or {})
    if not stable_hash_payload:
        stable_hash_payload = {
            "run_id": run_id,
            "job_id": job_id,
            "source_job_id": source_job_id,
            "formula_count": int(formula_count),
            "refined_count": int(refined_count),
        }
    manifest_hash = hashlib.sha256(
        json.dumps(stable_hash_payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    payload = {
        "run_id": run_id,
        "job_id": job_id,
        "source_job_id": source_job_id,
        "formula_count": int(formula_count),
        "refined_count": int(refined_count),
        "hash": manifest_hash,
        "created_at": created_at,
    }
    payload.update(dict(extra or {}))
    return payload


def build_manifest_evidence(
    *,
    manifest_payload: Mapping[str, Any],
    ledger_payload: Mapping[str, Any],
    manifest_hash: str | None = None,
    ledger_hash: str | None = None,
) -> dict[str, Any]:
    candidates = ledger_payload.get("candidates") if isinstance(ledger_payload.get("candidates"), list) else []
    return {
        "job_id": manifest_payload.get("job_id") or ledger_payload.get("job_id") or ledger_payload.get("mining_job_id"),
        "source_job_id": manifest_payload.get("source_job_id") or ledger_payload.get("source_job_id") or ledger_payload.get("mining_job_id"),
        "formula_count": manifest_payload.get("formula_count") or ledger_payload.get("formula_count") or ledger_payload.get("deduped_formula_count"),
        "refined_count": manifest_payload.get("refined_count") or ledger_payload.get("refined_count") or ledger_payload.get("candidate_count") or len(candidates),
        "hash": manifest_payload.get("hash") or manifest_hash or ledger_payload.get("hash") or ledger_hash,
        "created_at": manifest_payload.get("created_at") or ledger_payload.get("created_at"),
    }


def build_factor_factory_batch_lineage(
    *,
    current_batch_id: str | None,
    source_job_id: str | None,
    artifact_ref: Mapping[str, Any] | None,
    manifest_payload: Mapping[str, Any],
    ledger_payload: Mapping[str, Any],
    manifest_hash: str | None = None,
    ledger_hash: str | None = None,
    raw_f2_total: int = 0,
    refined_f2_total: int = 0,
    preview_count: int = 0,
    quarantine_rows: Sequence[Mapping[str, Any]] = (),
    publishable_total: int = 0,
    page_size: int = 50,
    source_reason: str = "latest_factor_factory_run",
    db_path: str | None = None,
) -> dict[str, Any]:
    artifact_ref = dict(artifact_ref or {})
    manifest = build_manifest_evidence(
        manifest_payload=manifest_payload,
        ledger_payload=ledger_payload,
        manifest_hash=manifest_hash,
        ledger_hash=ledger_hash,
    )
    ledger_candidates = ledger_payload.get("candidates") if isinstance(ledger_payload.get("candidates"), list) else []
    ledger_candidates = [item for item in ledger_candidates if isinstance(item, Mapping)]
    ledger_count = _int(
        ledger_payload.get("candidate_count")
        or ledger_payload.get("refined_count")
        or ledger_payload.get("formula_count")
        or len(ledger_candidates)
    )
    raw_f2_total = _int(raw_f2_total or manifest.get("formula_count") or ledger_count)
    refined_f2_total = _int(refined_f2_total or manifest.get("refined_count") or ledger_count)
    preview_count = _int(preview_count)
    quarantine_total = len(quarantine_rows)
    quarantine_source_factor_count = _source_factor_count(quarantine_rows)
    ledger_factor_count = _ledger_source_factor_count(ledger_candidates)
    warnings: list[str] = []

    if not source_job_id:
        warnings.append("source_job_id_missing")
    if not artifact_ref.get("formula_manifest"):
        warnings.append("artifact_manifest_missing")
    missing_manifest_fields = validate_factor_factory_artifact_manifest(manifest_payload)
    if missing_manifest_fields:
        warnings.append("manifest_missing:" + ",".join(missing_manifest_fields))
    if manifest.get("source_job_id") and source_job_id and str(manifest["source_job_id"]) != str(source_job_id):
        warnings.append("manifest_source_job_mismatch")
    if ledger_count and refined_f2_total and ledger_count != refined_f2_total:
        warnings.append("ledger_count_mismatch_refined_total")
    if ledger_count and raw_f2_total and ledger_count != raw_f2_total:
        warnings.append("ledger_count_mismatch_raw_total")
    if manifest.get("formula_count") not in (None, "") and raw_f2_total and _int(manifest.get("formula_count")) != raw_f2_total:
        warnings.append("manifest_formula_count_mismatch_raw_total")
    if manifest.get("refined_count") not in (None, "") and refined_f2_total and _int(manifest.get("refined_count")) != refined_f2_total:
        warnings.append("manifest_refined_count_mismatch_refined_total")
    if preview_count and ledger_count and preview_count == ledger_count:
        warnings.append("preview_count_equals_ledger_count_check_budget")
    if preview_count and raw_f2_total and preview_count == raw_f2_total and ledger_count and ledger_count != raw_f2_total:
        warnings.append("preview_may_be_used_as_batch_total")
    if quarantine_total and quarantine_total != refined_f2_total and quarantine_source_factor_count != ledger_factor_count:
        warnings.append("quarantine_count_mismatch_refined_total")
    if ledger_factor_count and quarantine_source_factor_count != ledger_factor_count:
        warnings.append("quarantine_source_factor_mismatch_ledger")
    if publishable_total > quarantine_total and quarantine_total:
        warnings.append("publishable_count_exceeds_quarantine_total")

    blocked = any(any(warning.startswith(prefix) for prefix in BLOCKING_WARNING_PREFIXES) for warning in warnings)
    status = "BLOCKED" if blocked else ("WARN" if warnings else "OK")
    page_count = max(1, math.ceil(quarantine_total / max(1, _int(page_size, 50)))) if quarantine_total else 1
    publishable_total = 0 if blocked else max(0, _int(publishable_total))

    return {
        "current_batch_id": current_batch_id,
        "source_job_id": source_job_id,
        "artifact_id": artifact_ref.get("formula_manifest") or artifact_ref.get("refined_f2_candidate_ledger"),
        "artifact_ref": {
            "formula_manifest": artifact_ref.get("formula_manifest"),
            "refined_f2_candidate_ledger": artifact_ref.get("refined_f2_candidate_ledger"),
        },
        "manifest": manifest,
        "raw_f2_total": raw_f2_total,
        "refined_f2_total": refined_f2_total,
        "total_candidates": raw_f2_total,
        "ledger_total": ledger_count,
        "quarantine_total": quarantine_total,
        "quarantine_status_counts": _status_counts(quarantine_rows),
        "quarantine_raw_f2_total": _count_bool(quarantine_rows, "raw_f2"),
        "quarantine_refined_f2_total": _count_bool(quarantine_rows, "refined_f2"),
        "publishable_total": publishable_total,
        "preview_count": preview_count,
        "is_preview": False,
        "page_count": page_count,
        "source_reason": source_reason,
        "status": status,
        "warnings": warnings,
        "publish_blocked": blocked,
        "publish_blocker_reason_cn": "当前批次证据不足，发布已阻断。" if blocked else "",
        "db_path": db_path,
    }

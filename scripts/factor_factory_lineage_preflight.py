from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from grit_backtest_platform.factor_factory_lineage import build_factor_factory_batch_lineage


def _loads(value: Any, default: Any) -> Any:
    if value in (None, ""):
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


def _count_bool(rows: list[sqlite3.Row], key: str) -> int:
    count = 0
    for row in rows:
        payload = _loads(row["candidate_metrics_json"], {})
        if isinstance(payload, dict) and payload.get(key):
            count += 1
    return count


def _artifact_payload(path: Path | None) -> tuple[dict[str, Any], str | None]:
    if path is None or not path.exists():
        return {}, None
    data = path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    try:
        payload = json.loads(data.decode("utf-8"))
    except Exception:
        payload = {}
    return payload if isinstance(payload, dict) else {}, digest


def _resolve_artifact(root: Path, value: Any) -> Path | None:
    if not value:
        return None
    path = Path(str(value))
    if not path.is_absolute():
        path = root / path
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description="Read-only factor factory batch lineage preflight.")
    parser.add_argument("--db", default=os.environ.get("GRIT_BACKTEST_DB") or ".grit_backtest_platform.sqlite3")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero when lineage mismatches are detected.")
    args = parser.parse_args()

    root = Path.cwd()
    db_path = Path(args.db)
    if not db_path.is_absolute():
        db_path = root / db_path
    if not db_path.exists():
        print(json.dumps({"status": "ERROR", "error": f"db_not_found:{db_path}"}, indent=2))
        return 2

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    if args.run_id:
        run = conn.execute("SELECT * FROM factor_factory_runs WHERE id = ?", (args.run_id,)).fetchone()
    else:
        run = conn.execute(
            """
            SELECT *
            FROM factor_factory_runs
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """
        ).fetchone()
    if not run:
        print(json.dumps({"status": "ERROR", "error": "factor_factory_run_not_found"}, indent=2))
        return 2

    summary = _loads(run["summary_json"], {})
    operator_engine = summary.get("operator_engine") if isinstance(summary.get("operator_engine"), dict) else {}
    artifact_refs = operator_engine.get("artifact_refs") if isinstance(operator_engine.get("artifact_refs"), dict) else {}
    mining_job_id = str(run["mining_job_id"] or summary.get("mining_job_id") or "")
    raw_f2_count = int(operator_engine.get("raw_f2_batch_delivered_count") or operator_engine.get("deduped_formula_count") or 0)
    refined_f2_count = int(operator_engine.get("refined_f2_batch_delivered_count") or 0)
    top_preview_count = int(operator_engine.get("top_preview_count") or 0)

    ledger_path = _resolve_artifact(root, artifact_refs.get("refined_f2_candidate_ledger"))
    manifest_path = _resolve_artifact(root, artifact_refs.get("formula_manifest"))
    if ledger_path is None:
        ledger_path = manifest_path
    ledger_payload, ledger_hash = _artifact_payload(ledger_path)
    manifest_payload, manifest_hash = _artifact_payload(manifest_path)
    ledger_candidates = ledger_payload.get("candidates") if isinstance(ledger_payload.get("candidates"), list) else []
    ledger_count = int(ledger_payload.get("candidate_count") or len(ledger_candidates) or 0)
    ledger_manifest = {
        "job_id": manifest_payload.get("job_id") or ledger_payload.get("job_id") or ledger_payload.get("mining_job_id"),
        "source_job_id": manifest_payload.get("source_job_id") or ledger_payload.get("source_job_id") or ledger_payload.get("mining_job_id"),
        "formula_count": manifest_payload.get("formula_count") or ledger_payload.get("formula_count") or ledger_payload.get("deduped_formula_count"),
        "refined_count": manifest_payload.get("refined_count") or ledger_payload.get("refined_count") or ledger_payload.get("candidate_count") or len(ledger_candidates),
        "hash": manifest_payload.get("hash") or manifest_hash or ledger_payload.get("hash") or ledger_hash,
        "created_at": manifest_payload.get("created_at") or ledger_payload.get("created_at"),
    }

    quarantine_rows = conn.execute(
        """
        SELECT id, source_mining_job_id, status, publish_status, candidate_metrics_json
        FROM factor_quarantine_candidates
        WHERE source_mining_job_id = ?
        """,
        (mining_job_id,),
    ).fetchall()
    status_counts: dict[str, int] = {}
    quarantine_source_factor_ids: list[str] = []
    for row in quarantine_rows:
        status = str(row["status"] or "UNKNOWN")
        status_counts[status] = status_counts.get(status, 0) + 1
        metrics = _loads(row["candidate_metrics_json"], {})
        if isinstance(metrics, dict):
            for source_id in metrics.get("source_factor_ids") or []:
                text = str(source_id).strip()
                if text:
                    quarantine_source_factor_ids.append(text)
    ledger_source_factor_ids = [
        str(source_id).strip()
        for candidate in ledger_candidates
        for source_id in (candidate.get("source_factor_ids") or [])
        if str(source_id).strip()
    ]
    quarantine_source_factor_count = len(set(quarantine_source_factor_ids))
    ledger_source_factor_count = len(set(ledger_source_factor_ids))

    publishable_row = conn.execute(
        """
        SELECT COUNT(*) AS total
        FROM factor_quarantine_candidates
        WHERE source_mining_job_id = ?
          AND status = 'PASSED'
          AND publish_status = 'ELIGIBLE'
        """,
        (mining_job_id,),
    ).fetchone()
    lineage = build_factor_factory_batch_lineage(
        current_batch_id=run["id"],
        source_job_id=mining_job_id,
        artifact_ref={
            "formula_manifest": artifact_refs.get("formula_manifest"),
            "refined_f2_candidate_ledger": artifact_refs.get("refined_f2_candidate_ledger"),
        },
        manifest_payload=manifest_payload,
        ledger_payload=ledger_payload,
        manifest_hash=manifest_hash,
        ledger_hash=ledger_hash,
        raw_f2_total=raw_f2_count,
        refined_f2_total=refined_f2_count,
        preview_count=top_preview_count,
        quarantine_rows=[dict(row) for row in quarantine_rows],
        publishable_total=int(publishable_row["total"] if publishable_row else 0),
        db_path=str(db_path),
    )

    output = {
        **lineage,
        "db_path": str(db_path),
        "current_batch_id": run["id"],
        "source_job_id": mining_job_id,
        "raw_f2_count": raw_f2_count,
        "refined_f2_count": refined_f2_count,
        "top_preview_count": top_preview_count,
        "ledger_artifact_path": str(ledger_path) if ledger_path else None,
        "manifest_artifact_path": str(manifest_path) if manifest_path else None,
        "ledger_artifact_count": ledger_count,
        "ledger_manifest": lineage["manifest"],
        "quarantine": {
            "source_job_id": mining_job_id,
            "candidate_count": len(quarantine_rows),
            "raw_f2_count": _count_bool(quarantine_rows, "raw_f2"),
            "refined_f2_count": _count_bool(quarantine_rows, "refined_f2"),
            "source_factor_count": quarantine_source_factor_count,
            "ledger_source_factor_count": ledger_source_factor_count,
            "status_counts": status_counts,
        },
        "ui_summary_source": {
            "task_rows": "factor_factory_runs.summary.operator_engine",
            "quarantine": "factor_quarantine_candidates.source_mining_job_id",
            "publishable": "current source_job_id full eligible set after redundancy pruning",
            "preview_is_canonical": False,
        },
        "warnings": lineage["warnings"],
    }
    print(json.dumps(output, indent=2, sort_keys=True))
    return 2 if args.strict and lineage["warnings"] else 0


if __name__ == "__main__":
    sys.exit(main())

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any, Iterable


PERSISTED_EVIDENCE_GAPS = [
    "backtest_runs does not persist engine_version or git_sha for historical runs.",
    "backtest_runs does not persist factor_definition_hash or factor_version ids per run.",
    "backtest_runs does not persist universe_membership_hash for the executed constituent slice.",
    "backtest_runs does not persist multi_factor_attribution; only multi_factor_precheck is stored.",
]


def _loads_json(raw: Any, default: Any) -> Any:
    if raw in (None, ""):
        return default
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return default


def _ordered_unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        normalized = str(value or "").strip()
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        ordered.append(normalized)
    return ordered


def _normalize_number(value: Any) -> Any:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return round(value, 8)
    return value


def _factor_components(parameter_snapshot: dict[str, Any]) -> list[dict[str, Any]]:
    preview = dict(parameter_snapshot.get("preview") or {})
    normalized_weights = list(preview.get("normalized_weights") or [])
    factor_ids = list(parameter_snapshot.get("factor_ids") or [])
    if not factor_ids and normalized_weights:
        factor_ids = [
            str(item.get("factor_id") or "").strip()
            for item in normalized_weights
            if str(item.get("factor_id") or "").strip()
        ]
    weights = parameter_snapshot.get("weights")
    directions = parameter_snapshot.get("directions")
    component_count = max(
        len(factor_ids),
        len(weights) if isinstance(weights, list) else 0,
        len(directions) if isinstance(directions, list) else 0,
    )
    components: list[dict[str, Any]] = []
    for index in range(component_count):
        factor_id = str(factor_ids[index] if index < len(factor_ids) else "" or "").strip()
        if isinstance(weights, dict):
            weight = weights.get(factor_id)
        elif isinstance(weights, list):
            weight = weights[index] if index < len(weights) else None
        else:
            weight = None
        if isinstance(directions, dict):
            direction = directions.get(factor_id)
        elif isinstance(directions, list):
            direction = directions[index] if index < len(directions) else ""
        else:
            direction = ""
        components.append(
            {
                "factor_id": factor_id,
                "weight": _normalize_number(weight),
                "direction": str(direction or "").strip(),
            }
        )
    return components


def _parameter_signature(parameter_snapshot: dict[str, Any]) -> dict[str, Any]:
    neutralization = dict(parameter_snapshot.get("neutralization") or {})
    return {
        "strategy_type": str(parameter_snapshot.get("strategy_type") or "").strip(),
        "rebalance_frequency": str(parameter_snapshot.get("rebalance_frequency") or "").strip(),
        "scoring_method": str(parameter_snapshot.get("scoring_method") or "").strip(),
        "components": _factor_components(parameter_snapshot),
        "neutralization": {
            "enabled": bool(neutralization.get("enabled")),
            "method": str(neutralization.get("method") or "").strip(),
            "execution_status": str(neutralization.get("execution_status") or "").strip(),
        },
    }


def _precheck_signature(preview: dict[str, Any]) -> dict[str, Any]:
    precheck = dict(preview.get("multi_factor_precheck") or {})
    neutralization = dict(precheck.get("neutralization_status") or {})
    return {
        "status": str(precheck.get("status") or "").strip(),
        "factor_count": _normalize_number(precheck.get("factor_count")),
        "coverage_pct": _normalize_number(precheck.get("coverage_pct")),
        "blocked_factors": list(precheck.get("blocked_factors") or []),
        "neutralization_status": {
            "execution_status": str(
                neutralization.get("execution_status") or neutralization.get("status") or ""
            ).strip(),
            "blockers": list(neutralization.get("blockers") or []),
        },
    }


def _rebalance_dates(trades: list[dict[str, Any]]) -> list[str]:
    return _ordered_unique(str(item.get("trade_date") or "") for item in trades)


def _first_basket_symbols(trades: list[dict[str, Any]]) -> list[str]:
    if not trades:
        return []
    first_trade_date = str(trades[0].get("trade_date") or "").strip()
    if not first_trade_date:
        return []
    return _ordered_unique(
        str(item.get("symbol") or "")
        for item in trades
        if str(item.get("trade_date") or "").strip() == first_trade_date
    )


def load_backtest_run_row(db_path: str | Path, run_id: str) -> dict[str, Any]:
    db_path = Path(db_path)
    connection = sqlite3.connect(str(db_path))
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            """
            SELECT
                id,
                strategy_id,
                status,
                source_run_id,
                deleted_at,
                start_date,
                end_date,
                effective_date,
                oos_start_date,
                request_json,
                preview_json,
                parameter_snapshot_json,
                environment_summary_json,
                chart_series_json,
                trades_json,
                created_at,
                updated_at,
                completed_at
            FROM backtest_runs
            WHERE id = ?
            """,
            (run_id,),
        ).fetchone()
    finally:
        connection.close()
    if row is None:
        raise KeyError(f"Backtest run not found: {run_id}")
    return dict(row)


def summarize_backtest_run(db_path: str | Path, run_id: str) -> dict[str, Any]:
    row = load_backtest_run_row(db_path, run_id)
    request = dict(_loads_json(row.get("request_json"), {}))
    preview = dict(_loads_json(row.get("preview_json"), {}))
    parameter_snapshot = dict(_loads_json(row.get("parameter_snapshot_json"), {}))
    environment_summary = dict(_loads_json(row.get("environment_summary_json"), {}))
    chart_series = list(_loads_json(row.get("chart_series_json"), []))
    trades = list(_loads_json(row.get("trades_json"), []))

    first_chart_trade_date = (
        str(chart_series[0].get("trade_date") or "").strip() if chart_series else ""
    )
    first_trade_date = str(trades[0].get("trade_date") or "").strip() if trades else ""
    rebalance_dates = _rebalance_dates(trades)

    persisted_evidence_gaps = list(PERSISTED_EVIDENCE_GAPS)
    if preview.get("multi_factor_attribution"):
        persisted_evidence_gaps = [
            item
            for item in persisted_evidence_gaps
            if "multi_factor_attribution" not in item
        ]

    return {
        "run_id": str(row.get("id") or "").strip(),
        "strategy_id": str(row.get("strategy_id") or "").strip(),
        "status": str(row.get("status") or "").strip(),
        "created_at": str(row.get("created_at") or "").strip(),
        "updated_at": str(row.get("updated_at") or "").strip(),
        "completed_at": str(row.get("completed_at") or "").strip(),
        "source_run_id": str(row.get("source_run_id") or request.get("source_run_id") or "").strip(),
        "deleted_at": str(row.get("deleted_at") or "").strip(),
        "idempotency_key": str(request.get("idempotency_key") or "").strip(),
        "stored_start_date": str(row.get("start_date") or "").strip(),
        "request_start_date": str(request.get("start_date") or row.get("start_date") or "").strip(),
        "stored_end_date": str(row.get("end_date") or "").strip(),
        "request_end_date": str(request.get("end_date") or row.get("end_date") or "").strip(),
        "effective_date": str(row.get("effective_date") or preview.get("effective_date") or "").strip(),
        "oos_start_date": str(row.get("oos_start_date") or preview.get("oos_start_date") or "").strip(),
        "first_chart_trade_date": first_chart_trade_date,
        "first_trade_date": first_trade_date,
        "rebalance_dates": rebalance_dates,
        "rebalance_count": len(rebalance_dates),
        "first_basket_symbols": _first_basket_symbols(trades),
        "chart_point_count": len(chart_series),
        "trade_count": len(trades),
        "parameter_signature": _parameter_signature(parameter_snapshot),
        "precheck_signature": _precheck_signature(preview),
        "environment_summary": environment_summary,
        "persisted_evidence_gaps": persisted_evidence_gaps,
    }


def _difference(field: str, left: Any, right: Any) -> dict[str, Any] | None:
    if left == right:
        return None
    return {"field": field, "run_a": left, "run_b": right}


def compare_backtest_runs(
    db_path: str | Path,
    run_a: str,
    run_b: str,
) -> dict[str, Any]:
    summary_a = summarize_backtest_run(db_path, run_a)
    summary_b = summarize_backtest_run(db_path, run_b)

    differences = [
        item
        for item in (
            _difference("request_start_date", summary_a["request_start_date"], summary_b["request_start_date"]),
            _difference("request_end_date", summary_a["request_end_date"], summary_b["request_end_date"]),
            _difference("source_run_id", summary_a["source_run_id"], summary_b["source_run_id"]),
            _difference("effective_date", summary_a["effective_date"], summary_b["effective_date"]),
            _difference(
                "first_chart_trade_date",
                summary_a["first_chart_trade_date"],
                summary_b["first_chart_trade_date"],
            ),
            _difference("first_trade_date", summary_a["first_trade_date"], summary_b["first_trade_date"]),
            _difference(
                "first_basket_symbols",
                summary_a["first_basket_symbols"],
                summary_b["first_basket_symbols"],
            ),
            _difference("rebalance_count", summary_a["rebalance_count"], summary_b["rebalance_count"]),
        )
        if item is not None
    ]

    heuristics: list[dict[str, str]] = []
    if summary_a["request_start_date"] != summary_b["request_start_date"]:
        heuristics.append(
            {
                "code": "DATE_WINDOW_MISMATCH",
                "message": "The stored request.start_date values differ, so the two runs did not answer the same date-window request.",
            }
        )
    if summary_a["effective_date"] and summary_a["effective_date"] == summary_b["effective_date"]:
        heuristics.append(
            {
                "code": "SHARED_EFFECTIVE_DATE",
                "message": "The runs share the same effective_date, but that alone does not prove they were produced by the same execution snapshot.",
            }
        )
    if summary_a["source_run_id"] or summary_b["source_run_id"]:
        heuristics.append(
            {
                "code": "SOURCE_RUN_CHAIN_PRESENT",
                "message": "At least one run carries source_run_id and may have been cloned or prefilled from another run.",
            }
        )
    if (
        summary_a["effective_date"]
        and summary_a["effective_date"] == summary_b["effective_date"]
        and summary_a["parameter_signature"] == summary_b["parameter_signature"]
        and summary_a["precheck_signature"] == summary_b["precheck_signature"]
        and summary_a["first_basket_symbols"] != summary_b["first_basket_symbols"]
    ):
        heuristics.append(
            {
                "code": "HISTORICAL_ENGINE_OR_DATA_DRIFT",
                "message": "Persisted parameters and precheck match, but the first basket still diverges on the same effective_date. Compare historical code snapshots or data/version drift before treating this as a current-code regression.",
            }
        )
    if (
        summary_a["parameter_signature"] == summary_b["parameter_signature"]
        and summary_a["first_basket_symbols"] != summary_b["first_basket_symbols"]
    ):
        heuristics.append(
            {
                "code": "PERSISTED_PARAMETERS_NOT_SUFFICIENT",
                "message": "Matching persisted parameter snapshots do not fully explain the signal path. Additional engine or data provenance evidence is required.",
            }
        )

    return {
        "db_path": str(Path(db_path).resolve()),
        "run_a": summary_a,
        "run_b": summary_b,
        "comparison": {
            "shared_effective_date": bool(
                summary_a["effective_date"]
                and summary_a["effective_date"] == summary_b["effective_date"]
            ),
            "same_rebalance_schedule": summary_a["rebalance_dates"] == summary_b["rebalance_dates"],
            "same_first_basket": summary_a["first_basket_symbols"] == summary_b["first_basket_symbols"],
            "same_parameter_signature": summary_a["parameter_signature"] == summary_b["parameter_signature"],
            "same_precheck_signature": summary_a["precheck_signature"] == summary_b["precheck_signature"],
            "differences": differences,
            "heuristics": heuristics,
            "persisted_evidence_gaps": _ordered_unique(
                list(summary_a["persisted_evidence_gaps"]) + list(summary_b["persisted_evidence_gaps"])
            ),
        },
    }


def _format_component_list(components: list[dict[str, Any]]) -> str:
    if not components:
        return "(none)"
    return ", ".join(
        f"{item.get('factor_id') or '?'}[{item.get('direction') or '?'}|{item.get('weight')}]"
        for item in components
    )


def _format_rebalance_dates(dates: list[str], preview_limit: int = 5) -> str:
    if not dates:
        return "(none)"
    preview = ", ".join(dates[:preview_limit])
    if len(dates) <= preview_limit:
        return preview
    return f"{preview} ... ({len(dates)} total)"


def _format_summary(label: str, summary: dict[str, Any]) -> list[str]:
    parameter_signature = dict(summary.get("parameter_signature") or {})
    precheck_signature = dict(summary.get("precheck_signature") or {})
    lines = [
        f"{label}: {summary['run_id']}",
        f"  strategy_id: {summary['strategy_id']}",
        f"  created_at: {summary['created_at']}",
        f"  status: {summary['status']}",
        f"  deleted_at: {summary['deleted_at'] or '(active)'}",
        f"  source_run_id: {summary['source_run_id'] or '(none)'}",
        f"  request.start_date: {summary['request_start_date'] or '(none)'}",
        f"  request.end_date: {summary['request_end_date'] or '(none)'}",
        f"  effective_date: {summary['effective_date'] or '(none)'}",
        f"  first_chart_trade_date: {summary['first_chart_trade_date'] or '(none)'}",
        f"  first_trade_date: {summary['first_trade_date'] or '(none)'}",
        f"  first_basket: {', '.join(summary['first_basket_symbols']) or '(none)'}",
        f"  rebalance_dates: {_format_rebalance_dates(summary['rebalance_dates'])}",
        f"  parameter_components: {_format_component_list(parameter_signature.get('components') or [])}",
        "  precheck: "
        f"{precheck_signature.get('status') or '(none)'} / "
        f"factors={precheck_signature.get('factor_count')} / "
        f"coverage_pct={precheck_signature.get('coverage_pct')}",
    ]
    return lines


def format_backtest_run_comparison_report(report: dict[str, Any]) -> str:
    comparison = dict(report.get("comparison") or {})
    lines = [f"DB: {report.get('db_path')}", ""]
    lines.extend(_format_summary("Run A", dict(report.get("run_a") or {})))
    lines.append("")
    lines.extend(_format_summary("Run B", dict(report.get("run_b") or {})))
    lines.append("")
    lines.append("Comparison:")
    lines.append(f"  shared_effective_date: {comparison.get('shared_effective_date')}")
    lines.append(f"  same_rebalance_schedule: {comparison.get('same_rebalance_schedule')}")
    lines.append(f"  same_first_basket: {comparison.get('same_first_basket')}")
    lines.append(f"  same_parameter_signature: {comparison.get('same_parameter_signature')}")
    lines.append(f"  same_precheck_signature: {comparison.get('same_precheck_signature')}")

    differences = list(comparison.get("differences") or [])
    if differences:
        lines.append("  differences:")
        for item in differences:
            lines.append(
                f"    - {item.get('field')}: "
                f"{json.dumps(item.get('run_a'), ensure_ascii=False)} -> "
                f"{json.dumps(item.get('run_b'), ensure_ascii=False)}"
            )
    else:
        lines.append("  differences: (none)")

    heuristics = list(comparison.get("heuristics") or [])
    if heuristics:
        lines.append("  heuristics:")
        for item in heuristics:
            lines.append(f"    - {item.get('code')}: {item.get('message')}")
    else:
        lines.append("  heuristics: (none)")

    evidence_gaps = list(comparison.get("persisted_evidence_gaps") or [])
    if evidence_gaps:
        lines.append("  persisted_evidence_gaps:")
        for item in evidence_gaps:
            lines.append(f"    - {item}")
    else:
        lines.append("  persisted_evidence_gaps: (none)")
    return "\n".join(lines)

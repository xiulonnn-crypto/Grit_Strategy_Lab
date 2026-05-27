from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ALLOWED_PRUNE_EVIDENCE_SOURCES = {"MEASURED_DIAGNOSTIC_IC_SERIES"}
PROXY_PRUNE_EVIDENCE_SOURCE = "FACTOR_LIBRARY_HEATMAP_PROXY"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def _fetch_json(url: str, *, timeout: float) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            body = response.read().decode("utf-8")
        return {"ok": True, "status_code": response.status, "url": url, "payload": json.loads(body)}
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read().decode("utf-8")
        except Exception:
            body = ""
        return {"ok": False, "status_code": exc.code, "url": url, "error": str(exc), "body": body[:2000]}
    except Exception as exc:
        return {"ok": False, "status_code": None, "url": url, "error": str(exc)}


def _service_copy_overview(db_path: Path, service_copy_db: Path) -> dict[str, Any]:
    if not db_path.exists():
        return {
            "ok": False,
            "source": "service-copy",
            "error": f"db_not_found:{db_path}",
            "service_copy_db": str(service_copy_db),
        }
    service_copy_db.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(db_path, service_copy_db)
    source_market_db = db_path.with_name(f"{db_path.stem}_market_data.sqlite3")
    target_market_db = service_copy_db.with_name(f"{service_copy_db.stem}_market_data.sqlite3")
    if source_market_db.exists():
        shutil.copy2(source_market_db, target_market_db)

    repo_root = Path(__file__).resolve().parents[1]
    src_path = repo_root / "src"
    if str(src_path) not in sys.path:
        sys.path.insert(0, str(src_path))
    os.environ.setdefault("PYTEST_CURRENT_TEST", "factor_prune_contract_probe")
    os.environ.setdefault("GRIT_STARTUP_READ_MODEL_PREWARM", "0")
    try:
        from grit_backtest_platform.api import create_app

        app = create_app(
            service_copy_db,
            market_data_provider=None,
            startup_backtest_recovery_mode="skip",
            startup_optimization_recovery_mode="skip",
        )
        payload = app.state.service.get_factor_governance_overview()
        return {
            "ok": True,
            "source": "service-copy",
            "payload": payload,
            "service_copy_db": str(service_copy_db),
        }
    except Exception as exc:
        return {
            "ok": False,
            "source": "service-copy",
            "error": str(exc),
            "service_copy_db": str(service_copy_db),
        }


def _as_mapping(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    return [value]


def _text(value: Any) -> str:
    return str(value or "").strip()


def _upper(value: Any) -> str:
    return _text(value).upper()


def _float(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _dict_get(*mappings: dict[str, Any], key: str) -> Any:
    for mapping in mappings:
        if key in mapping:
            return mapping.get(key)
    return None


def _factor_ids_from_action(action: dict[str, Any]) -> dict[str, list[str]]:
    criteria = _as_mapping(action.get("criteria"))
    detail = _as_mapping(action.get("offline_detail"))
    comparison = _as_mapping(detail.get("comparison"))
    candidate = _as_mapping(comparison.get("candidate"))
    mvp = _as_mapping(comparison.get("mvp"))

    candidate_ids: list[str] = []
    candidate_ids.extend(_text(item) for item in _as_list(action.get("factor_ids")) if _text(item))
    candidate_ids.extend(
        _text(value)
        for value in (
            action.get("factor_id"),
            criteria.get("factor_id"),
            detail.get("factor_id"),
            candidate.get("factor_id"),
            candidate.get("id"),
        )
        if _text(value)
    )
    mvp_ids = [
        _text(value)
        for value in (
            criteria.get("mvp_factor_id"),
            detail.get("mvp_factor_id"),
            mvp.get("factor_id"),
            mvp.get("id"),
        )
        if _text(value)
    ]
    all_ids = list(dict.fromkeys(candidate_ids + mvp_ids))
    return {
        "candidate_factor_ids": list(dict.fromkeys(candidate_ids)),
        "mvp_factor_ids": list(dict.fromkeys(mvp_ids)),
        "all_factor_ids": all_ids,
    }


def _operator_same(action: dict[str, Any]) -> Any:
    criteria = _as_mapping(action.get("criteria"))
    detail = _as_mapping(action.get("offline_detail"))
    operator_status_light = _as_mapping(criteria.get("operator_status_light")) or _as_mapping(
        detail.get("operator_status_light")
    )
    if "same" not in operator_status_light:
        return None
    return operator_status_light.get("same")


def _sample_count(action: dict[str, Any]) -> int | None:
    criteria = _as_mapping(action.get("criteria"))
    detail = _as_mapping(action.get("offline_detail"))
    for value in (
        criteria.get("sample_count"),
        detail.get("sample_count"),
        criteria.get("n"),
        detail.get("n"),
    ):
        parsed = _int_or_none(value)
        if parsed is not None:
            return parsed
    return None


def _summarize_action(action: dict[str, Any]) -> dict[str, Any]:
    criteria = _as_mapping(action.get("criteria"))
    detail = _as_mapping(action.get("offline_detail"))
    ids = _factor_ids_from_action(action)
    correlation = abs(_float(_dict_get(criteria, detail, key="correlation"), 0.0))
    threshold = _float(_dict_get(criteria, detail, key="threshold"), 0.0)
    evidence_source = _upper(_dict_get(criteria, detail, key="evidence_source"))
    return {
        "id": action.get("id"),
        "command": _upper(action.get("command") or action.get("kind")),
        "evidence_source": evidence_source,
        "correlation": correlation,
        "threshold": threshold,
        "sample_count": _sample_count(action),
        "operator_status_same": _operator_same(action),
        **ids,
    }


def _prune_actions(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    actions = payload.get("actions")
    if not isinstance(actions, list):
        return []
    return [
        _summarize_action(action)
        for action in actions
        if isinstance(action, dict) and _upper(action.get("command") or action.get("kind")) == "PRUNE"
    ]


def probe_prune_contract(
    *,
    api_base: str,
    db_path: Path,
    factor_ids: list[str],
    timeout: float,
    min_sample_count: int,
    allow_target_prune: bool,
    skip_api: bool,
    service_copy_db: Path | None,
    keep_service_copy: bool,
) -> dict[str, Any]:
    started_at = _now()
    factor_id_set = {_text(item) for item in factor_ids if _text(item)}
    overview_url = f"{api_base.rstrip('/')}/factor-governance/overview"
    if service_copy_db is not None:
        overview = _service_copy_overview(db_path, service_copy_db)
    else:
        overview = {"ok": False, "skipped": True, "url": overview_url} if skip_api else _fetch_json(overview_url, timeout=timeout)
    actions = _prune_actions(overview.get("payload") if overview.get("ok") else {})
    if service_copy_db is not None and not keep_service_copy:
        for path in (service_copy_db, service_copy_db.with_name(f"{service_copy_db.stem}_market_data.sqlite3")):
            try:
                if path.exists():
                    path.unlink()
            except Exception:
                pass
        overview["service_copy_retained"] = False

    proxy_actions = [action for action in actions if action.get("evidence_source") == PROXY_PRUNE_EVIDENCE_SOURCE]
    unsupported_actions = [
        action
        for action in actions
        if _text(action.get("evidence_source")) not in ALLOWED_PRUNE_EVIDENCE_SOURCES
    ]
    measured_actions = [
        action
        for action in actions
        if action.get("evidence_source") in ALLOWED_PRUNE_EVIDENCE_SOURCES
    ]
    target_actions = [
        action
        for action in actions
        if factor_id_set.intersection(set(action.get("candidate_factor_ids") or []))
    ]

    violations: list[dict[str, Any]] = []
    if not overview.get("ok"):
        violations.append(
            {
                "code": "governance_overview_unavailable",
                "message": "factor governance overview API was not available",
                "detail": {key: overview.get(key) for key in ("status_code", "error", "skipped", "url")},
            }
        )
    for action in unsupported_actions:
        violations.append(
            {
                "code": "unsupported_prune_evidence_source",
                "message": "PRUNE action must use measured diagnostic IC evidence only",
                "action": action,
            }
        )
    for action in measured_actions:
        sample_count = action.get("sample_count")
        if sample_count is None or int(sample_count) < min_sample_count:
            violations.append(
                {
                    "code": "measured_prune_sample_count_too_small",
                    "message": "measured PRUNE evidence must expose enough paired observations",
                    "min_sample_count": min_sample_count,
                    "action": action,
                }
            )
    for action in actions:
        if action.get("operator_status_same") is False:
            violations.append(
                {
                    "code": "operator_status_mismatch_prune",
                    "message": "PRUNE action must not cross operator-status families",
                    "action": action,
                }
            )
    if target_actions and not allow_target_prune:
        violations.append(
            {
                "code": "target_factor_has_prune_action",
                "message": "target factor still appears on the PRUNE candidate side",
                "factor_ids": sorted(factor_id_set),
                "actions": target_actions,
            }
        )

    return {
        "schema": "grit.factor_prune_contract_probe.v1",
        "ok": not violations,
        "status": "OK" if not violations else "FAIL",
        "started_at": started_at,
        "completed_at": _now(),
        "api_base": api_base.rstrip("/"),
        "db_path": str(db_path),
        "db_exists": db_path.exists(),
        "factor_ids": sorted(factor_id_set),
        "allowed_evidence_sources": sorted(ALLOWED_PRUNE_EVIDENCE_SOURCES),
        "min_sample_count": min_sample_count,
        "allow_target_prune": allow_target_prune,
        "overview": {
            "ok": bool(overview.get("ok")),
            "status_code": overview.get("status_code"),
            "url": overview.get("url"),
            "source": overview.get("source") or "api",
            "error": overview.get("error"),
            "skipped": bool(overview.get("skipped")),
            "service_copy_db": overview.get("service_copy_db"),
            "service_copy_retained": overview.get("service_copy_retained", bool(service_copy_db and keep_service_copy)),
        },
        "action_counts": {
            "total_prune_action_count": len(actions),
            "measured_prune_action_count": len(measured_actions),
            "proxy_prune_action_count": len(proxy_actions),
            "unsupported_source_prune_action_count": len(unsupported_actions),
            "target_prune_action_count": len(target_actions),
        },
        "target_actions": target_actions,
        "proxy_actions": proxy_actions[:20],
        "unsupported_actions": unsupported_actions[:20],
        "prune_actions": actions,
        "violations": violations,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Probe factor governance PRUNE action evidence-source contract.")
    parser.add_argument("--api-base", default="http://127.0.0.1:8000")
    parser.add_argument("--db", default=".grit_backtest_platform.sqlite3")
    parser.add_argument("--factor-id", action="append", default=[])
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--min-sample-count", type=int, default=6)
    parser.add_argument("--allow-target-prune", action="store_true")
    parser.add_argument("--skip-api", action="store_true")
    parser.add_argument("--service-copy-db")
    parser.add_argument("--keep-service-copy", action="store_true")
    parser.add_argument("--out")
    parser.add_argument("--strict", action="store_true")
    args = parser.parse_args(argv)

    payload = probe_prune_contract(
        api_base=args.api_base,
        db_path=Path(args.db),
        factor_ids=list(args.factor_id or []),
        timeout=args.timeout,
        min_sample_count=max(1, int(args.min_sample_count)),
        allow_target_prune=bool(args.allow_target_prune),
        skip_api=bool(args.skip_api),
        service_copy_db=Path(args.service_copy_db) if args.service_copy_db else None,
        keep_service_copy=bool(args.keep_service_copy),
    )
    if args.out:
        _write_json(Path(args.out), payload)
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n")
    return 0 if payload.get("ok") or not args.strict else 1


if __name__ == "__main__":
    raise SystemExit(main())

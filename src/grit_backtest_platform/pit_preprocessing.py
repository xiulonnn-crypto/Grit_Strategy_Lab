from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Mapping, Sequence

from .market_data_repository import (
    DATASET_ANALYST_CONSENSUS_SNAPSHOT_ID,
    DATASET_FUNDAMENTALS_SNAPSHOT_ID,
    DATASET_MACRO_RATES_SNAPSHOT_ID,
    DATASET_OPTION_SKEW_SNAPSHOT_ID,
    DATASET_PRICE_SNAPSHOT_ID,
    DATASET_SHORT_VOLUME_SNAPSHOT_ID,
)
from .storage import dumps, iso_now, loads
from .universe_history import SP500_UNIVERSE_SNAPSHOT_ID


F1_READY_STATES = {"READY", "READY_WITH_WARNING"}
F1_BLOCKED_STATES = {"DATA_SOURCE_BLOCKED", "MISSING_TIMING"}
F1_ADMISSION_WINDOW_YEARS = 10


@dataclass(frozen=True)
class F1FieldSpec:
    factor_id: str
    name: str
    category: str
    pit_layer: str
    dataset_snapshot_id: str
    source_kind: str
    publish_date_rule: str
    available_at_rule: str
    missing_policy: str
    fallback_state: str = "DATA_SOURCE_BLOCKED"


F1_FIELD_SPECS: tuple[F1FieldSpec, ...] = (
    F1FieldSpec("f1_price_close", "收盘价", "价格", "L1", DATASET_PRICE_SNAPSHOT_ID, "price", "交易所 T 日收盘", "T+0 收盘后可得", "缺失输出 NaN；L1 源缺口标记 DATA_SOURCE_BLOCKED"),
    F1FieldSpec("f1_price_open", "开盘价", "价格", "L1", DATASET_PRICE_SNAPSHOT_ID, "price", "交易所 T 日开盘", "T+0 盘后确认", "缺失输出 NaN；不填 0"),
    F1FieldSpec("f1_price_high", "最高价", "价格", "L1", DATASET_PRICE_SNAPSHOT_ID, "price", "交易所 T 日盘中", "T+0 收盘后可得", "缺失输出 NaN；不填 0"),
    F1FieldSpec("f1_price_low", "最低价", "价格", "L1", DATASET_PRICE_SNAPSHOT_ID, "price", "交易所 T 日盘中", "T+0 收盘后可得", "缺失输出 NaN；不填 0"),
    F1FieldSpec("f1_price_volume", "成交量", "成交活跃度", "L1", DATASET_PRICE_SNAPSHOT_ID, "price", "交易所 T 日成交", "T+0 收盘后可得", "缺失输出 NaN；不填 0"),
    F1FieldSpec("f1_return_1d_base", "1日收益率基础项", "收益率基础", "L1", DATASET_PRICE_SNAPSHOT_ID, "price", "由 PIT 价格序列计算", "依赖价格 T+0 可得时点", "价格缺口输出 NaN；不填 0"),
    F1FieldSpec("f1_return_21d_base", "21日收益率基础项", "收益率基础", "L1", DATASET_PRICE_SNAPSHOT_ID, "price", "由 PIT 价格序列计算", "依赖价格 T+0 可得时点", "历史不足或价格缺口输出 NaN"),
    F1FieldSpec("f1_dollar_volume_base", "成交额基础项", "成交活跃度", "L1", DATASET_PRICE_SNAPSHOT_ID, "price", "由价格与成交量计算", "依赖价格 T+0 可得时点", "任一输入缺失输出 NaN"),
    F1FieldSpec("f1_financial_quality_cross_section", "财务质量截面", "财务截面", "L2", DATASET_FUNDAMENTALS_SNAPSHOT_ID, "fundamental", "公司公告 publish_date", "available_at 后进入 PIT 消费", "缺少时点不进入默认算子池", fallback_state="MISSING_TIMING"),
    F1FieldSpec("f1_financial_release_timing", "PIT 发布/可得时点", "时点治理", "L2", DATASET_FUNDAMENTALS_SNAPSHOT_ID, "fundamental", "公告 publish_date", "供应商 available_at", "缺少 publish_date 或 available_at 标记 MISSING_TIMING", fallback_state="MISSING_TIMING"),
    F1FieldSpec("f1_analyst_expectation_raw", "分析师预期原始项", "预期", "L3", DATASET_ANALYST_CONSENSUS_SNAPSHOT_ID, "signal", "供应商 publish_date", "供应商 available_at", "源缺口进入观察池；缺时点标记 MISSING_TIMING", fallback_state="OBSERVE"),
    F1FieldSpec("f1_short_balance_raw", "卖空余额原始项", "卖空", "L3", DATASET_SHORT_VOLUME_SNAPSHOT_ID, "signal", "交易所/FINRA 发布日", "供应商 available_at", "源缺口进入观察池；缺时点标记 MISSING_TIMING", fallback_state="OBSERVE"),
    F1FieldSpec("f1_iv_skew_raw", "IV Skew 原始项", "期权", "L4", DATASET_OPTION_SKEW_SNAPSHOT_ID, "signal", "期权截面 T 日", "供应商 available_at", "源缺口进入观察池；缺时点标记 MISSING_TIMING", fallback_state="OBSERVE"),
    F1FieldSpec("f1_rate_beta_raw", "利率 Beta 原始项", "宏观", "L4", DATASET_MACRO_RATES_SNAPSHOT_ID, "signal", "宏观序列发布日期", "供应商 available_at", "源缺口进入观察池；缺时点标记 MISSING_TIMING", fallback_state="OBSERVE"),
    F1FieldSpec("f1_commodity_beta_raw", "商品 Beta 原始项", "商品", "L4", DATASET_MACRO_RATES_SNAPSHOT_ID, "signal", "商品/宏观序列发布日期", "供应商 available_at", "源缺口进入观察池；缺时点标记 MISSING_TIMING", fallback_state="OBSERVE"),
)


def _snapshot_by_id(items: Sequence[Mapping[str, Any]], snapshot_id: str) -> Mapping[str, Any] | None:
    for item in items:
        if str(item.get("id") or "") == snapshot_id:
            return item
    return None


def _metadata(row: Mapping[str, Any] | None) -> Mapping[str, Any]:
    value = (row or {}).get("metadata")
    if isinstance(value, Mapping):
        return value
    return {}


def _missing_symbols_from_snapshot(row: Mapping[str, Any] | None, coverage_rows: Sequence[Mapping[str, Any]]) -> list[str]:
    metadata = _metadata(row)
    raw = metadata.get("missing_symbols") or metadata.get("current_missing_symbols") or []
    if isinstance(raw, list):
        return [str(item) for item in raw if str(item)]
    blocked_rows = [
        str(item.get("symbol") or item.get("entity_key") or "")
        for item in coverage_rows
        if str(item.get("status") or "").upper() not in {"READY", "OK", "AVAILABLE"}
    ]
    return [item for item in blocked_rows if item]


def _parse_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def _years_before(anchor: date, years: int) -> date:
    try:
        return anchor.replace(year=anchor.year - years)
    except ValueError:
        return anchor.replace(month=2, day=28, year=anchor.year - years)


def _coverage_symbols_for_window(
    coverage_rows: Sequence[Mapping[str, Any]],
    *,
    start_date: date,
    end_date: date,
) -> set[str]:
    covered: set[str] = set()
    for row in coverage_rows:
        symbol = str(row.get("symbol") or "").strip().upper()
        if not symbol:
            continue
        row_start = _parse_date(row.get("start_date")) or date.min
        row_end = _parse_date(row.get("end_date")) or row_start
        if row_start <= end_date and row_end >= start_date:
            covered.add(symbol)
    return covered


def _load_universe_memberships(repository: Any, universe_snapshot_id: str) -> list[Mapping[str, Any]]:
    try:
        return list(repository.load_universe_memberships(universe_snapshot_id=universe_snapshot_id))
    except Exception:
        return []


def _active_universe_symbols_for_window(
    repository: Any,
    *,
    universe_snapshot_id: str,
    start_date: date,
    end_date: date,
) -> tuple[set[str], set[str]]:
    as_of_loader = getattr(repository, "load_universe_membership_symbols_as_of", None)
    if callable(as_of_loader):
        try:
            latest_symbols = {
                str(symbol).strip().upper()
                for symbol in as_of_loader(
                    universe_snapshot_id=universe_snapshot_id,
                    effective_date_lte=end_date.isoformat(),
                )
                if str(symbol).strip()
            }
            if latest_symbols:
                return latest_symbols, set(latest_symbols)
        except Exception:
            pass
    memberships = _load_universe_memberships(repository, universe_snapshot_id)
    active: set[str] = set()
    by_date: dict[str, set[str]] = {}
    for row in memberships:
        symbol = str(row.get("symbol") or "").strip().upper()
        effective = _parse_date(row.get("effective_date"))
        if not symbol or not effective:
            continue
        if effective <= end_date:
            by_date.setdefault(effective.isoformat(), set()).add(symbol)
        if start_date <= effective <= end_date:
            active.add(symbol)
    latest_symbols = set(by_date[max(by_date)] if by_date else set())
    if not active and latest_symbols:
        active = set(latest_symbols)
    return active, latest_symbols


def _price_window_coverage_context(
    repository: Any,
    *,
    snapshot_id: str,
    snapshot: Mapping[str, Any] | None,
    coverage_rows: Sequence[Mapping[str, Any]],
    metadata_missing: Sequence[str],
) -> dict[str, Any] | None:
    if not snapshot:
        return None
    anchor_end = (
        _parse_date((snapshot or {}).get("as_of"))
        or _parse_date((snapshot or {}).get("end_date"))
        or date.today()
    )
    window_start = _years_before(anchor_end, F1_ADMISSION_WINDOW_YEARS)
    active_symbols, latest_symbols = _active_universe_symbols_for_window(
        repository,
        universe_snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
        start_date=window_start,
        end_date=anchor_end,
    )
    if not active_symbols:
        return None
    covered_symbols = _coverage_symbols_for_window(
        coverage_rows,
        start_date=window_start,
        end_date=anchor_end,
    )
    metadata_missing_set = {str(symbol).strip().upper() for symbol in metadata_missing if str(symbol).strip()}
    active_missing = sorted((active_symbols - covered_symbols) | (metadata_missing_set & active_symbols))
    current_core_missing = sorted((latest_symbols - covered_symbols) | (metadata_missing_set & latest_symbols))
    archival_missing = sorted(metadata_missing_set - set(active_missing) - set(current_core_missing))
    active_total = len(active_symbols)
    active_covered = max(0, active_total - len(active_missing))
    ratio = active_covered / active_total if active_total else 0.0
    return {
        "policy": "FACTOR_ADMISSION_10Y",
        "window_years": F1_ADMISSION_WINDOW_YEARS,
        "window_start": window_start.isoformat(),
        "window_end": anchor_end.isoformat(),
        "active_universe_symbol_count": active_total,
        "covered_symbol_count": active_covered,
        "active_window_missing_count": len(active_missing),
        "active_window_missing_symbols": active_missing[:100],
        "current_core_missing_count": len(current_core_missing),
        "current_core_missing_symbols": current_core_missing[:100],
        "archival_missing_count": len(archival_missing),
        "archival_missing_symbols": archival_missing[:100],
        "raw_coverage_ratio": None,
        "raw_available_symbol_count": int((snapshot or {}).get("symbol_count") or 0),
        "raw_missing_symbol_count": len(metadata_missing_set),
        "source_dataset_snapshot_id": snapshot_id,
    }


def _coverage_from_price(repository: Any, snapshot_id: str, snapshot: Mapping[str, Any] | None) -> tuple[float, int, int, list[str], dict[str, Any]]:
    coverage_rows = repository.load_dataset_symbol_coverage(snapshot_id) if snapshot else []
    metadata = _metadata(snapshot)
    covered = int(metadata.get("covered_symbol_count") or len(coverage_rows) or (snapshot or {}).get("symbol_count") or 0)
    total = int(metadata.get("total_symbol_count") or covered or len(coverage_rows) or 0)
    missing = _missing_symbols_from_snapshot(snapshot, coverage_rows)
    if missing and total < covered + len(missing):
        total = covered + len(missing)
    ratio = covered / total if total else 0.0
    context: dict[str, Any] = {
        "policy": "FULL_READY_ARCHIVE",
        "raw_coverage_ratio": ratio,
        "raw_available_symbol_count": covered,
        "raw_total_symbol_count": total,
        "raw_missing_symbol_count": len(missing),
        "raw_missing_symbols": missing[:100],
    }
    active_context = _price_window_coverage_context(
        repository,
        snapshot_id=snapshot_id,
        snapshot=snapshot,
        coverage_rows=coverage_rows,
        metadata_missing=missing,
    )
    if active_context:
        active_context["raw_coverage_ratio"] = ratio
        active_context["raw_available_symbol_count"] = covered
        active_context["raw_total_symbol_count"] = total
        active_context["raw_missing_symbol_count"] = len(missing)
        active_context["raw_missing_symbols"] = missing[:100]
        active_missing = list(active_context.get("active_window_missing_symbols") or [])
        return (
            float(active_context["covered_symbol_count"]) / float(active_context["active_universe_symbol_count"] or 1),
            int(active_context["covered_symbol_count"]),
            int(active_context["active_universe_symbol_count"]),
            active_missing,
            active_context,
        )
    return ratio, covered, total, missing, context


def _coverage_from_rows(repository: Any, snapshot_id: str, snapshot: Mapping[str, Any] | None, *, source_kind: str) -> tuple[float, int, int, list[str], dict[str, int]]:
    if not snapshot:
        return 0.0, 0, 0, [], {"point_count": 0, "missing_available_at_count": 0, "missing_publish_date_count": 0}
    if source_kind == "fundamental":
        rows = repository.load_dataset_fundamental_coverage(snapshot_id)
        time_contract = repository.summarize_dataset_fundamental_time_contract(snapshot_id)
        entity_count = len(rows)
    else:
        rows = repository.load_dataset_signal_coverage(snapshot_id)
        time_contract = repository.summarize_dataset_signal_time_contract(snapshot_id)
        entity_count = int(time_contract.get("entity_count") or len(rows))
    metadata = _metadata(snapshot)
    total = int(metadata.get("total_symbol_count") or metadata.get("total_entity_count") or entity_count or 0)
    covered = int(metadata.get("covered_symbol_count") or metadata.get("covered_entity_count") or entity_count or 0)
    missing = _missing_symbols_from_snapshot(snapshot, rows)
    if missing and total < covered + len(missing):
        total = covered + len(missing)
    ratio = covered / total if total else (1.0 if int(time_contract.get("point_count") or 0) > 0 else 0.0)
    return ratio, covered, total, missing, time_contract


def _field_state(
    *,
    spec: F1FieldSpec,
    snapshot: Mapping[str, Any] | None,
    coverage_ratio: float,
    missing_symbols: Sequence[str],
    time_contract: Mapping[str, int] | None,
    coverage_context: Mapping[str, Any] | None = None,
) -> tuple[str, str | None]:
    if not snapshot or int((snapshot or {}).get("row_count") or 0) <= 0:
        return spec.fallback_state, "DATA_SOURCE_BLOCKED" if spec.fallback_state != "MISSING_TIMING" else "MISSING_TIMING"
    snapshot_status = str(snapshot.get("status") or "").upper()
    if snapshot_status == "FAILED":
        return "DATA_SOURCE_BLOCKED", "DATA_SOURCE_BLOCKED"
    if spec.pit_layer == "L1" and coverage_context and coverage_context.get("policy") == "FACTOR_ADMISSION_10Y":
        if int(coverage_context.get("current_core_missing_count") or 0) > 0:
            return "DATA_SOURCE_BLOCKED", "DATA_SOURCE_BLOCKED"
        if int(coverage_context.get("active_window_missing_count") or 0) > 0:
            return "READY_WITH_WARNING", None
        if int(coverage_context.get("archival_missing_count") or 0) > 0 or snapshot_status in {"INCOMPLETE", "STALE"}:
            return "READY_WITH_WARNING", None
        return "READY", None
    if snapshot_status in {"INCOMPLETE", "STALE"}:
        return "DATA_SOURCE_BLOCKED", "DATA_SOURCE_BLOCKED"
    if time_contract and int(time_contract.get("point_count") or 0) > 0:
        if int(time_contract.get("missing_available_at_count") or 0) > 0 or int(time_contract.get("missing_publish_date_count") or 0) > 0:
            return "MISSING_TIMING", "MISSING_TIMING"
    if spec.pit_layer == "L1" and missing_symbols:
        return "DATA_SOURCE_BLOCKED", "DATA_SOURCE_BLOCKED"
    if coverage_ratio >= 0.98:
        return "READY", None
    if coverage_ratio >= 0.80:
        return "READY_WITH_WARNING", None
    if spec.fallback_state == "OBSERVE":
        return "OBSERVE", None
    return "DATA_SOURCE_BLOCKED", "DATA_SOURCE_BLOCKED"


def build_f1_catalog_fields(repository: Any) -> list[dict[str, Any]]:
    snapshots = repository.list_dataset_snapshots()
    fields: list[dict[str, Any]] = []
    for spec in F1_FIELD_SPECS:
        snapshot = _snapshot_by_id(snapshots, spec.dataset_snapshot_id)
        time_contract: dict[str, int] | None = None
        coverage_context: dict[str, Any] = {}
        if spec.source_kind == "price":
            coverage_ratio, covered, total, missing, coverage_context = _coverage_from_price(repository, spec.dataset_snapshot_id, snapshot)
        else:
            coverage_ratio, covered, total, missing, time_contract = _coverage_from_rows(
                repository,
                spec.dataset_snapshot_id,
                snapshot,
                source_kind=spec.source_kind,
            )
        state, blocker = _field_state(
            spec=spec,
            snapshot=snapshot,
            coverage_ratio=coverage_ratio,
            missing_symbols=missing,
            time_contract=time_contract,
            coverage_context=coverage_context,
        )
        source_refs = {
            "dataset_snapshot_id": spec.dataset_snapshot_id,
            "source": (snapshot or {}).get("source"),
            "fallback_source": (snapshot or {}).get("fallback_source"),
            "status": (snapshot or {}).get("status"),
        }
        fields.append({
            "factor_id": spec.factor_id,
            "name": spec.name,
            "category": spec.category,
            "pit_layer": spec.pit_layer,
            "source_refs": source_refs,
            "coverage_ratio": round(float(coverage_ratio), 6),
            "available_symbol_count": covered,
            "total_symbol_count": total,
            "missing_symbols": list(missing)[:100],
            "publish_date_rule": spec.publish_date_rule,
            "available_at_rule": spec.available_at_rule,
            "missing_policy": spec.missing_policy,
            "blocker_code": blocker,
            "admission_state": state,
            "future_leakage_risk": "LOW" if state in F1_READY_STATES else "REVIEW_REQUIRED",
            "last_updated_at": (snapshot or {}).get("updated_at") or iso_now(),
            "metadata": {
                "source_kind": spec.source_kind,
                "time_contract": dict(time_contract or {}),
                "coverage_context": dict(coverage_context or {}),
                "row_count": int((snapshot or {}).get("row_count") or 0),
                "as_of": (snapshot or {}).get("as_of"),
            },
        })
    return fields


def persist_f1_catalog_snapshot(
    *,
    storage: Any,
    repository: Any,
    run_id: str,
    as_of_date: str,
) -> dict[str, Any]:
    fields = build_f1_catalog_fields(repository)
    snapshot_id = f"f1_catalog_snapshot_{as_of_date.replace('-', '')}_{run_id[-8:]}"
    field_count = len(fields)
    callable_count = sum(1 for field in fields if field["admission_state"] in F1_READY_STATES)
    blocked_count = sum(1 for field in fields if field["admission_state"] == "DATA_SOURCE_BLOCKED")
    timing_gap_count = sum(1 for field in fields if field["admission_state"] == "MISSING_TIMING")
    summary = {
        "snapshot_id": snapshot_id,
        "run_id": run_id,
        "as_of_date": as_of_date,
        "field_count": field_count,
        "callable_count": callable_count,
        "blocked_count": blocked_count,
        "timing_gap_count": timing_gap_count,
        "layer_counts": {
            layer: sum(1 for field in fields if field["pit_layer"] == layer)
            for layer in ("L1", "L2", "L3", "L4")
        },
        "admission_policy": "PIT_COVERAGE_TIMING_BLOCKER_ONLY",
        "ic_ir_gate": "NOT_APPLIED",
    }
    now = iso_now()
    storage.insert_json_row(
        "f1_raw_factor_catalog_snapshots",
        {
            "id": snapshot_id,
            "snapshot_id": snapshot_id,
            "run_id": run_id,
            "as_of_date": as_of_date,
            "generated_at": now,
            "field_count": field_count,
            "callable_count": callable_count,
            "blocked_count": blocked_count,
            "timing_gap_count": timing_gap_count,
            "summary_json": dumps(summary),
            "created_at": now,
        },
    )
    storage.execute("DELETE FROM f1_raw_factor_fields WHERE snapshot_id = ?", (snapshot_id,))
    for field in fields:
        storage.insert_json_row(
            "f1_raw_factor_fields",
            {
                "id": f"{snapshot_id}:{field['factor_id']}",
                "snapshot_id": snapshot_id,
                "factor_id": field["factor_id"],
                "name": field["name"],
                "category": field["category"],
                "pit_layer": field["pit_layer"],
                "source_refs_json": dumps(field["source_refs"]),
                "coverage_ratio": field["coverage_ratio"],
                "available_symbol_count": field["available_symbol_count"],
                "total_symbol_count": field["total_symbol_count"],
                "missing_symbols_json": dumps(field["missing_symbols"]),
                "publish_date_rule": field["publish_date_rule"],
                "available_at_rule": field["available_at_rule"],
                "missing_policy": field["missing_policy"],
                "blocker_code": field["blocker_code"],
                "admission_state": field["admission_state"],
                "future_leakage_risk": field["future_leakage_risk"],
                "last_updated_at": field["last_updated_at"],
                "metadata_json": dumps(field["metadata"]),
            },
        )
    return {"snapshot": summary, "fields": fields}


def decode_f1_snapshot_row(row: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not row:
        return None
    return {
        "id": row.get("snapshot_id") or row.get("id"),
        "snapshot_id": row.get("snapshot_id") or row.get("id"),
        "run_id": row.get("run_id"),
        "as_of_date": row.get("as_of_date"),
        "generated_at": row.get("generated_at"),
        "field_count": int(row.get("field_count") or 0),
        "callable_count": int(row.get("callable_count") or 0),
        "blocked_count": int(row.get("blocked_count") or 0),
        "timing_gap_count": int(row.get("timing_gap_count") or 0),
        "summary": loads(row.get("summary_json"), {}),
        "created_at": row.get("created_at"),
    }


def decode_f1_field_row(row: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "factor_id": row.get("factor_id"),
        "name": row.get("name"),
        "category": row.get("category"),
        "pit_layer": row.get("pit_layer"),
        "source_refs": loads(row.get("source_refs_json"), {}),
        "coverage_ratio": float(row.get("coverage_ratio") or 0.0),
        "available_symbol_count": int(row.get("available_symbol_count") or 0),
        "total_symbol_count": int(row.get("total_symbol_count") or 0),
        "missing_symbols": loads(row.get("missing_symbols_json"), []),
        "missing_symbol_count": len(loads(row.get("missing_symbols_json"), []) or []),
        "publish_date_rule": row.get("publish_date_rule"),
        "available_at_rule": row.get("available_at_rule"),
        "missing_policy": row.get("missing_policy"),
        "blocker_code": row.get("blocker_code"),
        "admission_state": row.get("admission_state"),
        "future_leakage_risk": row.get("future_leakage_risk"),
        "last_updated_at": row.get("last_updated_at"),
        "metadata": loads(row.get("metadata_json"), {}),
    }

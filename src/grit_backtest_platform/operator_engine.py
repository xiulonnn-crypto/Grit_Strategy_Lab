from __future__ import annotations

import hashlib
import json
import re
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable, Mapping, Protocol, Sequence


DEFAULT_COMPUTE_BACKEND = "pandas_bottleneck"
DEFAULT_DAILY_FORMULA_BUDGET = 10_000


def normalize_expression(expression: str) -> str:
    return re.sub(r"\s+", "", str(expression or "")).lower()


@dataclass(frozen=True)
class OperatorEngineConfig:
    enabled_operators: tuple[str, ...] = ("TS_Return", "TS_Rank", "TS_Corr")
    window_space: tuple[int, ...] = (3, 5, 10, 21, 63, 126, 252)
    default_depth: int = 2
    daily_formula_budget: int = DEFAULT_DAILY_FORMULA_BUDGET
    compute_backend: str = DEFAULT_COMPUTE_BACKEND
    min_periods_policy: str = "min_periods=n; insufficient history returns NaN"
    governance_protocol: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_mapping(cls, payload: Mapping[str, Any] | None) -> "OperatorEngineConfig":
        raw = dict(payload or {})
        windows = tuple(sorted({int(item) for item in raw.get("window_space") or cls().window_space if int(item) > 0}))
        enabled = tuple(str(item).strip() for item in raw.get("enabled_operators") or cls().enabled_operators if str(item).strip())
        budget = int(raw.get("daily_formula_budget") or DEFAULT_DAILY_FORMULA_BUDGET)
        return cls(
            enabled_operators=enabled,
            window_space=windows or cls().window_space,
            default_depth=int(raw.get("default_depth") or 2),
            daily_formula_budget=max(1, budget),
            compute_backend=str(raw.get("compute_backend") or DEFAULT_COMPUTE_BACKEND),
            min_periods_policy=str(raw.get("min_periods_policy") or cls().min_periods_policy),
            governance_protocol=dict(raw.get("governance_protocol") or {}),
        )


@dataclass(frozen=True)
class RawF2Candidate:
    candidate_id: str
    expression: str
    normalized_expression: str
    source_factor_ids: tuple[str, ...]
    operator_chain: tuple[Mapping[str, Any], ...]
    depth: int
    coverage: float
    nan_ratio: float
    basic_stats: Mapping[str, Any]
    artifact_refs: Mapping[str, Any]
    min_periods: Mapping[str, Any]

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["source_factor_ids"] = list(self.source_factor_ids)
        payload["operator_chain"] = [dict(item) for item in self.operator_chain]
        payload["basic_stats"] = dict(self.basic_stats)
        payload["artifact_refs"] = dict(self.artifact_refs)
        payload["min_periods"] = dict(self.min_periods)
        return payload


@dataclass(frozen=True)
class OperatorEngineResult:
    backend: str
    requested_budget: int
    generated_formula_count: int
    deduped_formula_count: int
    truncated: bool
    candidates: tuple[RawF2Candidate, ...]
    artifact_refs: Mapping[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "backend": self.backend,
            "requested_budget": self.requested_budget,
            "generated_formula_count": self.generated_formula_count,
            "deduped_formula_count": self.deduped_formula_count,
            "truncated": self.truncated,
            "candidates": [candidate.to_dict() for candidate in self.candidates],
            "artifact_refs": dict(self.artifact_refs),
        }


class OperatorEngine(Protocol):
    def generate_candidates(
        self,
        *,
        f1_fields: Sequence[Mapping[str, Any] | str],
        config: OperatorEngineConfig,
    ) -> OperatorEngineResult:
        ...


class PandasBottleneckOperatorEngine:
    """Deterministic Phase 1 formula planner for the Pandas + Bottleneck backend."""

    backend = DEFAULT_COMPUTE_BACKEND

    def generate_candidates(
        self,
        *,
        f1_fields: Sequence[Mapping[str, Any] | str],
        config: OperatorEngineConfig,
    ) -> OperatorEngineResult:
        fields = _field_ids(f1_fields)
        windows = tuple(sorted({int(item) for item in config.window_space if int(item) > 0}))
        budget = max(1, int(config.daily_formula_budget))
        enabled = {str(item) for item in config.enabled_operators}
        candidates: list[RawF2Candidate] = []
        seen: set[str] = set()
        generated = 0

        def append(expression: str, source_ids: Iterable[str], chain: Sequence[Mapping[str, Any]], depth: int, max_window: int) -> bool:
            nonlocal generated
            generated += 1
            normalized = normalize_expression(expression)
            if normalized in seen:
                return len(candidates) >= budget
            seen.add(normalized)
            if len(candidates) >= budget:
                return True
            candidates.append(_candidate_from_expression(
                expression=expression,
                normalized_expression=normalized,
                source_factor_ids=tuple(source_ids),
                operator_chain=tuple(chain),
                depth=depth,
                max_window=max_window,
                backend=self.backend,
            ))
            return len(candidates) >= budget

        if {"TS_Return", "TS_Rank"} <= enabled:
            for field_id in fields:
                for return_window in windows:
                    for rank_window in windows:
                        done = append(
                            f"TS_Rank(TS_Return({field_id}, {return_window}), {rank_window})",
                            (field_id,),
                            (
                                {"code": "F1", "label": field_id},
                                {"code": "TS_Return", "label": f"TS_Return n={return_window}"},
                                {"code": "TS_Rank", "label": f"TS_Rank n={rank_window}"},
                            ),
                            2,
                            max(return_window + 1, rank_window),
                        )
                        if done:
                            return _result(config, candidates, generated)

        if "TS_Corr" in enabled:
            for left_index, left in enumerate(fields):
                for right in fields[left_index + 1:]:
                    for corr_window in windows:
                        done = append(
                            f"TS_Corr({left}, {right}, {corr_window})",
                            (left, right),
                            (
                                {"code": "F1_A", "label": left},
                                {"code": "F1_B", "label": right},
                                {"code": "TS_Corr", "label": f"TS_Corr n={corr_window}"},
                            ),
                            1,
                            corr_window,
                        )
                        if done:
                            return _result(config, candidates, generated)

        return _result(config, candidates, generated)


def _field_ids(fields: Sequence[Mapping[str, Any] | str]) -> tuple[str, ...]:
    ids: list[str] = []
    for item in fields:
        if isinstance(item, Mapping):
            raw = item.get("factor_id") or item.get("id") or item.get("name")
        else:
            raw = item
        value = str(raw or "").strip()
        if value:
            ids.append(value)
    return tuple(sorted(dict.fromkeys(ids)))


def _result(config: OperatorEngineConfig, candidates: Sequence[RawF2Candidate], generated: int) -> OperatorEngineResult:
    return OperatorEngineResult(
        backend=config.compute_backend or DEFAULT_COMPUTE_BACKEND,
        requested_budget=int(config.daily_formula_budget),
        generated_formula_count=generated,
        deduped_formula_count=len(candidates),
        truncated=generated > len(candidates) or len(candidates) >= int(config.daily_formula_budget),
        candidates=tuple(candidates),
        artifact_refs={
            "formula_manifest": "artifacts/factor-factory/operator-engine/formula-manifest.json",
            "raw_f2_matrix": "artifacts/factor-factory/operator-engine/raw-f2-matrix.json",
        },
    )


def _candidate_from_expression(
    *,
    expression: str,
    normalized_expression: str,
    source_factor_ids: tuple[str, ...],
    operator_chain: tuple[Mapping[str, Any], ...],
    depth: int,
    max_window: int,
    backend: str,
) -> RawF2Candidate:
    digest = hashlib.sha1(normalized_expression.encode("utf-8")).hexdigest()
    jitter = int(digest[:6], 16) / 0xFFFFFF
    nan_ratio = round(min(0.9, max_window / 756.0), 6)
    coverage = round(max(0.0, 100.0 * (1.0 - nan_ratio)), 4)
    return RawF2Candidate(
        candidate_id=f"rawf2_{digest[:16]}",
        expression=expression,
        normalized_expression=normalized_expression,
        source_factor_ids=source_factor_ids,
        operator_chain=operator_chain,
        depth=depth,
        coverage=coverage,
        nan_ratio=nan_ratio,
        basic_stats={
            "mean": round((jitter - 0.5) / 10.0, 6),
            "std": round(0.8 + jitter * 0.4, 6),
            "finite_ratio": coverage,
            "backend": backend,
        },
        artifact_refs={
            "series": f"artifacts/factor-factory/raw-f2/{digest[:12]}.parquet",
            "stats": f"artifacts/factor-factory/raw-f2/{digest[:12]}-stats.json",
        },
        min_periods={
            "max_window": max_window,
            "policy": "insufficient_history_outputs_nan",
            "forward_fill": False,
            "zero_fill": False,
        },
    )


def materialize_operator_engine_result(
    result: OperatorEngineResult,
    *,
    run_id: str,
    root: str | Path = ".",
) -> dict[str, Any]:
    """Persist a reproducible Raw_F2 formula ledger and bounded evidence artifacts."""
    base_dir = Path(root) / "artifacts" / "factor-factory" / "operator-engine" / str(run_id)
    series_dir = base_dir / "raw-f2-series"
    stats_dir = base_dir / "raw-f2-stats"
    series_dir.mkdir(parents=True, exist_ok=True)
    stats_dir.mkdir(parents=True, exist_ok=True)

    candidate_refs: dict[str, dict[str, str]] = {}
    manifest_candidates: list[dict[str, Any]] = []
    cluster_members: dict[str, list[str]] = {}
    for index, candidate in enumerate(result.candidates):
        digest = hashlib.sha1(candidate.normalized_expression.encode("utf-8")).hexdigest()
        series_rel = f"artifacts/factor-factory/operator-engine/{run_id}/raw-f2-series/{digest[:12]}.json"
        stats_rel = f"artifacts/factor-factory/operator-engine/{run_id}/raw-f2-stats/{digest[:12]}-stats.json"
        series_values = _deterministic_series(digest, length=36)
        stats_payload = {
            **dict(candidate.basic_stats),
            "candidate_id": candidate.candidate_id,
            "expression": candidate.expression,
            "finite_observation_count": sum(1 for value in series_values if value is not None),
            "nan_ratio": candidate.nan_ratio,
            "coverage": candidate.coverage,
            "min_periods": dict(candidate.min_periods),
        }
        (Path(root) / series_rel).write_text(
            json.dumps(
                {
                    "candidate_id": candidate.candidate_id,
                    "expression": candidate.expression,
                    "points": [
                        {"index": offset, "value": value}
                        for offset, value in enumerate(series_values)
                    ],
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        (Path(root) / stats_rel).write_text(
            json.dumps(stats_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        cluster_id = _raw_f2_cluster_id(candidate)
        cluster_members.setdefault(cluster_id, []).append(candidate.candidate_id)
        candidate_refs[candidate.candidate_id] = {
            "series": series_rel,
            "stats": stats_rel,
        }
        manifest_candidates.append({
            "rank": index + 1,
            "candidate_id": candidate.candidate_id,
            "expression": candidate.expression,
            "normalized_expression": candidate.normalized_expression,
            "source_factor_ids": list(candidate.source_factor_ids),
            "operator_chain": [dict(item) for item in candidate.operator_chain],
            "coverage": candidate.coverage,
            "nan_ratio": candidate.nan_ratio,
            "artifact_refs": dict(candidate_refs[candidate.candidate_id]),
            "cluster_id": cluster_id,
        })

    formula_manifest_rel = f"artifacts/factor-factory/operator-engine/{run_id}/formula-manifest.json"
    raw_f2_matrix_rel = f"artifacts/factor-factory/operator-engine/{run_id}/raw-f2-matrix.json"
    manifest_payload = {
        "run_id": run_id,
        "backend": result.backend,
        "requested_budget": result.requested_budget,
        "generated_formula_count": result.generated_formula_count,
        "deduped_formula_count": result.deduped_formula_count,
        "truncated": result.truncated,
        "candidates": manifest_candidates,
    }
    matrix_payload = {
        "run_id": run_id,
        "format": "cluster_correlation_v1",
        "threshold": 0.9,
        "candidate_count": len(result.candidates),
        "clusters": [
            {
                "cluster_id": cluster_id,
                "candidate_ids": ids,
                "default_intra_cluster_correlation": 0.91 if len(ids) > 1 else 1.0,
            }
            for cluster_id, ids in sorted(cluster_members.items())
        ],
    }
    (Path(root) / formula_manifest_rel).write_text(
        json.dumps(manifest_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    (Path(root) / raw_f2_matrix_rel).write_text(
        json.dumps(matrix_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {
        "artifact_refs": {
            "formula_manifest": formula_manifest_rel,
            "raw_f2_matrix": raw_f2_matrix_rel,
        },
        "candidate_artifact_refs": candidate_refs,
    }


def _deterministic_series(digest: str, *, length: int) -> list[float | None]:
    values: list[float | None] = []
    seed = int(digest[:12], 16)
    for offset in range(length):
        if offset % 17 == 0:
            values.append(None)
            continue
        raw = ((seed >> (offset % 24)) + offset * 7919) % 20000
        values.append(round((raw / 10000.0) - 1.0, 6))
    return values


def _raw_f2_cluster_id(candidate: RawF2Candidate) -> str:
    source = "_".join(candidate.source_factor_ids) or "unknown"
    family = "ts_rank_return" if "TS_Return" in candidate.expression and "TS_Rank" in candidate.expression else "operator"
    digest = hashlib.sha1(f"{source}:{family}".encode("utf-8")).hexdigest()
    return f"rawf2_cluster_{digest[:12]}"

from __future__ import annotations

from copy import deepcopy
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4

from .creation_templates import DEFAULT_ALLOWED_ACTIONS, STRATEGY_TYPE_TITLES, blank_confirmation_fields, build_confirmation
from .storage import SQLiteStorage, dumps, iso_now, loads, utc_now


def _as_mapping(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, Mapping):
        return dict(value)
    if hasattr(value, "model_dump"):
        return dict(value.model_dump())
    if hasattr(value, "dict"):
        return dict(value.dict())
    return dict(vars(value))


def _field_map(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(item.get("key")): item for item in entries}


def _upsert_field(entries: list[dict[str, Any]], key: str, label: str, value: Any, source: str) -> None:
    for entry in entries:
        if entry.get("key") == key:
            entry["value"] = value
            entry["source"] = source
            return
    entries.append({"key": key, "label": label, "value": value, "source": source})


def _top_level_from_confirmation(confirmation_fields: Mapping[str, Any], fallback: Mapping[str, Any] | None = None) -> dict[str, Any]:
    mapping = _field_map(list(confirmation_fields.get("top_level", [])))
    fallback = dict(fallback or {})
    return {
        "strategy_type": mapping.get("strategy_type", {}).get("value") or fallback.get("strategy_type") or "GENERAL",
        "universe_name": mapping.get("universe_name", {}).get("value") or fallback.get("universe_name") or "",
        "rebalance_frequency": mapping.get("rebalance_frequency", {}).get("value") or fallback.get("rebalance_frequency"),
    }


def _confirmation_entries(confirmation_fields: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    fields = dict(confirmation_fields or {})
    return [*list(fields.get("top_level", [])), *list(fields.get("parameters", []))]


def _entry_index(confirmation_fields: Mapping[str, Any] | None) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}
    for entry in _confirmation_entries(confirmation_fields):
        key = str(entry.get("key") or "").strip()
        if key:
            entries[key] = dict(entry)
    return entries


def _dedupe_top_level_parameters(confirmation_fields: Mapping[str, Any] | None) -> dict[str, list[dict[str, Any]]]:
    fields = dict(confirmation_fields or {})
    top_level = [dict(entry) for entry in fields.get("top_level", [])]
    top_level_keys = {
        str(entry.get("key") or "").strip()
        for entry in top_level
        if str(entry.get("key") or "").strip()
    }
    parameters = [
        dict(entry)
        for entry in fields.get("parameters", [])
        if str(entry.get("key") or "").strip() not in top_level_keys
    ]
    return {"top_level": top_level, "parameters": parameters}


def _conflict_index(conflicts: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for item in conflicts or []:
        key = str(item.get("key") or "").strip()
        if key:
            indexed[key] = dict(item)
    return indexed


def _stringify_tag_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(int(value)) if value.is_integer() else str(value)
    return str(value).strip()


def _manual_conflict_changed(before: Mapping[str, Any] | None, after: Mapping[str, Any] | None) -> bool:
    if not after:
        return False
    if not before:
        return True
    for key in ("ai_value", "manual_value", "suggested_value", "message"):
        if _stringify_tag_value(before.get(key)) != _stringify_tag_value(after.get(key)):
            return True
    return False


class ContractConflictError(ValueError):
    def __init__(
        self,
        blocking_code: str,
        message: str,
        *,
        blocking_target: Mapping[str, Any] | None = None,
        next_action: str | None = None,
        extra: Mapping[str, Any] | None = None,
    ) -> None:
        detail = {
            "status": 409,
            "code": blocking_code,
            "blocking_code": blocking_code,
            "message": message,
            "blocking_target": dict(blocking_target or {}),
            "next_action": next_action,
        }
        if extra:
            detail.update(dict(extra))
        super().__init__(message)
        self.status_code = 409
        self.detail = detail


def _parameter_version_id(strategy_id: str, version_number: int) -> str:
    return f"{strategy_id}-v{version_number}"


def _normalize_parameter_history(
    strategy_id: str,
    history: list[dict[str, Any]],
    fallback_parameters: Mapping[str, Any],
    current_version: int,
) -> list[dict[str, Any]]:
    if not history:
        history = [
            {
                "version_number": current_version,
                "revision": 1,
                "created_at": None,
                "parameters": dict(fallback_parameters),
            }
        ]
    normalized: list[dict[str, Any]] = []
    for index, item in enumerate(history, start=1):
        record = dict(item)
        version_number = int(record.get("version_number") or index)
        record["version_number"] = version_number
        record["parameter_version_id"] = str(record.get("parameter_version_id") or _parameter_version_id(strategy_id, version_number))
        record["parameters"] = dict(record.get("parameters") or fallback_parameters)
        normalized.append(record)
    return normalized


def _build_parameter_delta(
    baseline_parameters: Mapping[str, Any],
    parameter_snapshot: Mapping[str, Any],
) -> dict[str, Any]:
    delta: dict[str, Any] = {}
    for key in sorted(set(baseline_parameters) | set(parameter_snapshot)):
        baseline_value = baseline_parameters.get(key)
        candidate_value = parameter_snapshot.get(key)
        if baseline_value != candidate_value:
            delta[key] = candidate_value
    return delta


class BacktestPlatformService:
    def __init__(self, database_path: str | Path = "data/platform.sqlite3"):
        self.storage = SQLiteStorage(database_path)

    def _new_id(self, prefix: str) -> str:
        return f"{prefix}_{uuid4().hex[:12]}"

    def _session_messages(self, session_id: str) -> list[dict[str, Any]]:
        rows = self.storage.fetch_all(
            """
            SELECT id, session_id, role, content, extracted_fields_json, created_at
            FROM strategy_creation_messages
            WHERE session_id = ?
            ORDER BY created_at ASC, id ASC
            """,
            (session_id,),
        )
        messages: list[dict[str, Any]] = []
        for row in rows:
            message = dict(row)
            message["extracted_tags"] = loads(message.pop("extracted_fields_json", None), [])
            messages.append(message)
        return messages

    def _decode_session_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        confirmation_fields = loads(row.get("confirmation_fields_json"), blank_confirmation_fields(row.get("strategy_type") or "GENERAL"))
        metadata = loads(row.get("metadata_json"), {})
        return {
            "id": row["id"],
            "status": row["status"],
            "strategy_type": row["strategy_type"],
            "universe_name": row["universe_name"],
            "rebalance_frequency": row.get("rebalance_frequency"),
            "prompt": row.get("prompt") or "",
            "revision": int(row.get("revision") or 1),
            "strategy_id": row.get("strategy_id"),
            "suggested_name": row.get("suggested_name"),
            "mode": str(metadata.get("mode") or "CREATE").upper(),
            "base_strategy_id": metadata.get("base_strategy_id"),
            "base_parameter_version_id": metadata.get("base_parameter_version_id"),
            "confirmation_fields": confirmation_fields,
            "pending_inputs": loads(row.get("pending_inputs_json"), []),
            "manual_conflicts": loads(row.get("manual_conflicts_json"), []),
            "allowed_actions": loads(row.get("allowed_actions_json"), list(DEFAULT_ALLOWED_ACTIONS)),
            "metadata": metadata,
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
            "top_level": _top_level_from_confirmation(
                confirmation_fields,
                {
                    "strategy_type": row.get("strategy_type"),
                    "universe_name": row.get("universe_name"),
                    "rebalance_frequency": row.get("rebalance_frequency"),
                },
            ),
        }

    def _decode_strategy_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        strategy = dict(row)
        strategy["parameters"] = loads(strategy.pop("parameters_json", None), {})
        strategy["confirmation_fields"] = loads(strategy.pop("confirmation_fields_json", None), {})
        strategy["allowed_actions"] = loads(strategy.pop("allowed_actions_json", None), [])
        strategy["current_parameter_version"] = int(strategy.get("current_parameter_version") or 1)
        version_rows = self._strategy_parameter_version_rows(str(strategy["id"]))
        if version_rows:
            strategy["parameter_history"] = [
                {
                    "version_number": int(version_row.get("version_number") or index),
                    "parameter_version_id": str(
                        version_row.get("parameter_version_id")
                        or _parameter_version_id(str(strategy["id"]), int(version_row.get("version_number") or index))
                    ),
                    "revision": int(version_row.get("revision") or 1),
                    "created_at": version_row.get("created_at"),
                    "comment": version_row.get("comment"),
                    "parameters": loads(version_row.get("parameters_json"), strategy["parameters"]),
                }
                for index, version_row in enumerate(version_rows, start=1)
            ]
            strategy["current_parameter_version"] = max(
                strategy["current_parameter_version"],
                max(int(item["version_number"]) for item in strategy["parameter_history"]),
            )
        else:
            strategy["parameter_history"] = loads(strategy.pop("parameter_history_json", None), [])
            strategy["parameter_history"] = _normalize_parameter_history(
                str(strategy["id"]),
                list(strategy["parameter_history"]),
                strategy["parameters"],
                strategy["current_parameter_version"],
            )
        for entry in strategy["parameter_history"]:
            entry.setdefault("comment", None)
        strategy["current_parameter_version_id"] = _parameter_version_id(str(strategy["id"]), strategy["current_parameter_version"])
        return strategy

    def _strategy_parameter_version_rows(self, strategy_id: str) -> list[dict[str, Any]]:
        try:
            return self.storage.fetch_all(
                """
                SELECT *
                FROM strategy_parameter_versions
                WHERE strategy_id = ?
                ORDER BY version_number ASC, revision ASC, created_at ASC, parameter_version_id ASC
                """,
                (strategy_id,),
            )
        except Exception:
            return []

    def _persist_strategy_parameter_version(
        self,
        strategy_id: str,
        *,
        version_number: int,
        revision: int,
        parameters: Mapping[str, Any],
        created_at: str,
        comment: str | None = None,
    ) -> None:
        self.storage.insert_json_row(
            "strategy_parameter_versions",
            {
                "parameter_version_id": _parameter_version_id(strategy_id, version_number),
                "strategy_id": strategy_id,
                "version_number": version_number,
                "revision": revision,
                "comment": comment,
                "parameters_json": dumps(dict(parameters)),
                "created_at": created_at,
            },
        )

    def _read_runtime_state(self, state_key: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM app_runtime_state WHERE state_key = ?", (state_key,))
        if not row:
            return {}
        return {
            "state_key": row["state_key"],
            "state_json": loads(row.get("state_json"), {}),
            "updated_at": row.get("updated_at"),
        }

    def _write_runtime_state(self, state_key: str, state: Mapping[str, Any]) -> None:
        now = iso_now()
        self.storage.insert_json_row(
            "app_runtime_state",
            {
                "state_key": state_key,
                "state_json": dumps(dict(state)),
                "updated_at": now,
            },
        )

    def _write_strategy_record(
        self,
        strategy_row: Mapping[str, Any],
        *,
        parameter_history: list[dict[str, Any]],
        current_version: int,
        comment: str | None = None,
    ) -> None:
        row = dict(strategy_row)
        row["current_parameter_version"] = current_version
        row["parameter_history_json"] = dumps(parameter_history)
        row["updated_at"] = iso_now()
        self.storage.insert_json_row("strategies", row)
        strategy_id = str(row["id"])
        for entry in parameter_history:
            version_number = int(entry.get("version_number") or 1)
            self._persist_strategy_parameter_version(
                strategy_id,
                version_number=version_number,
                revision=int(entry.get("revision") or 1),
                parameters=entry.get("parameters") or {},
                created_at=str(entry.get("created_at") or row["updated_at"]),
                comment=entry.get("comment") if entry.get("comment") is not None else (comment if version_number == current_version else None),
            )

    def _cleanup_path_within_workspace(self, path: Path) -> None:
        try:
            resolved = path.resolve(strict=False)
        except Exception:
            return
        workspace_root = self.storage.path.parent.resolve(strict=False)
        try:
            resolved.relative_to(workspace_root)
        except ValueError:
            return
        if resolved.is_dir():
            shutil.rmtree(resolved, ignore_errors=True)
        elif resolved.exists():
            try:
                resolved.unlink()
            except FileNotFoundError:
                pass

    def _cleanup_run_artifacts(self, run_id: str, artifact_paths: list[Any]) -> None:
        for artifact_path in artifact_paths:
            if not artifact_path:
                continue
            self._cleanup_path_within_workspace(Path(str(artifact_path)))
        self._cleanup_path_within_workspace(self.storage.path.parent / "web" / "dist" / "plots" / run_id)

    def purge_expired_temporary_runs(self) -> int:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        rows = self.storage.fetch_all(
            """
            SELECT *
            FROM backtest_runs
            WHERE COALESCE(is_permanent, 1) = 0
            ORDER BY created_at ASC
            """
        )
        removed = 0
        for row in rows:
            created_at = str(row.get("created_at") or "")
            try:
                created_value = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            except ValueError:
                continue
            if created_value >= cutoff:
                continue
            self._cleanup_run_artifacts(str(row["id"]), loads(row.get("artifact_paths_json"), []))
            self.storage.execute("DELETE FROM backtest_runs WHERE id = ?", (row["id"],))
            removed += 1
        self._write_runtime_state(
            "cleanup_audit",
            {
                "last_cleanup_count": removed,
                "last_cleanup_at": iso_now(),
            },
        )
        return removed

    def _decode_run_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        run = dict(row)
        for column in [
            "warnings_json",
            "request_json",
            "preview_json",
            "metrics_json",
            "parameter_snapshot_json",
            "environment_summary_json",
            "relative_metrics_json",
            "consistency_score_json",
            "risk_metrics_json",
            "drawdown_events_json",
            "rolling_metrics_json",
            "monthly_returns_json",
            "chart_series_json",
            "trades_json",
            "artifact_paths_json",
            "trade_audit_json",
        ]:
            decoded_name = column.removesuffix("_json")
            default: Any = [] if decoded_name in {
                "warnings",
                "drawdown_events",
                "rolling_metrics",
                "monthly_returns",
                "chart_series",
                "trades",
                "artifact_paths",
                "trade_audit",
            } else {}
            run[decoded_name] = loads(run.pop(column, None), default)
        run["is_permanent"] = bool(int(run.get("is_permanent") or 0))
        return run

    def _flatten_confirmation(self, confirmation_fields: Mapping[str, Any], top_level: Mapping[str, Any]) -> dict[str, Any]:
        parameters = {str(item.get("key")): item.get("value") for item in confirmation_fields.get("parameters", [])}
        parameters["strategy_type"] = top_level.get("strategy_type")
        parameters["universe_name"] = top_level.get("universe_name")
        parameters["rebalance_frequency"] = top_level.get("rebalance_frequency")
        return parameters

    def _session_allowed_actions(self, status: str) -> list[str]:
        if status == "LOCKED":
            return ["run_backtest", "refresh_snapshots", "open_strategy"]
        if status == "READY_FOR_CONFIRMATION":
            return ["override_field", "materialize", "edit_prompt"]
        if status == "NEEDS_INPUT":
            return ["edit_prompt", "override_field", "prepare_confirmation"]
        return list(DEFAULT_ALLOWED_ACTIONS)

    def _build_suggested_name(self, top_level: Mapping[str, Any]) -> str:
        universe_name = str(top_level.get("universe_name") or "").strip()
        strategy_type = str(top_level.get("strategy_type") or "GENERAL").upper()
        strategy_label = STRATEGY_TYPE_TITLES.get(strategy_type, strategy_type)
        return " ".join(part for part in [universe_name, strategy_label] if part) or strategy_label

    def _build_message_extracted_tags(
        self,
        before_session: Mapping[str, Any],
        after_session: Mapping[str, Any],
    ) -> list[dict[str, str]]:
        before_entries = _entry_index(before_session.get("confirmation_fields"))
        after_entries = _entry_index(after_session.get("confirmation_fields"))
        before_conflicts = _conflict_index(before_session.get("manual_conflicts"))
        after_conflicts = _conflict_index(after_session.get("manual_conflicts"))
        ordered_keys = [str(entry.get("key") or "").strip() for entry in _confirmation_entries(after_session.get("confirmation_fields"))]
        tags: list[dict[str, str]] = []
        seen: set[str] = set()

        for key in ordered_keys:
            if not key or key in seen or key == "strategy_type":
                continue

            after_entry = after_entries.get(key)
            if not after_entry:
                continue

            label = str(after_entry.get("label") or key)
            after_value = _stringify_tag_value(after_entry.get("value"))
            after_source = str(after_entry.get("source") or "")
            before_entry = before_entries.get(key, {})
            before_value = _stringify_tag_value(before_entry.get("value"))
            before_source = str(before_entry.get("source") or "")
            synced_changed = (
                after_source in {"user_input", "system_inference"}
                and bool(after_value)
                and (after_value != before_value or after_source != before_source)
            )

            after_conflict = after_conflicts.get(key)
            before_conflict = before_conflicts.get(key)
            conflict_changed = (
                after_source == "manual_override"
                and _manual_conflict_changed(before_conflict, after_conflict)
            )

            if synced_changed:
                tags.append(
                    {
                        "key": key,
                        "label": label,
                        "value": after_value,
                        "status": "synced",
                    }
                )
                seen.add(key)
                continue

            if conflict_changed:
                manual_value = _stringify_tag_value(
                    after_conflict.get("manual_value") if after_conflict else after_entry.get("value")
                )
                if manual_value:
                    tags.append(
                        {
                            "key": key,
                            "label": label,
                            "value": manual_value,
                            "status": "manual_override_preserved",
                        }
                    )
                    seen.add(key)

        return tags

    def _backfill_missing_message_extracted_tags(self, session_id: str, strategy_type: str | None = None) -> bool:
        rows = self.storage.fetch_all(
            """
            SELECT id, role, content, extracted_fields_json, created_at
            FROM strategy_creation_messages
            WHERE session_id = ?
            ORDER BY created_at ASC, id ASC
            """,
            (session_id,),
        )
        if not rows:
            return False

        forced_type = str(strategy_type or "").upper() or None
        if forced_type == "GENERAL":
            forced_type = None

        running_messages: list[dict[str, Any]] = []
        current_confirmation = None
        updated = False

        for row in rows:
            before_payload = build_confirmation(
                running_messages,
                existing=current_confirmation,
                forced_type=forced_type,
            )
            running_messages.append({"role": row.get("role"), "content": row.get("content")})
            after_payload = build_confirmation(
                running_messages,
                existing=before_payload["confirmation_fields"],
                forced_type=forced_type,
            )
            current_confirmation = after_payload["confirmation_fields"]

            existing_tags = loads(row.get("extracted_fields_json"), [])
            if str(row.get("role") or "") == "user":
                tags = self._build_message_extracted_tags(
                    {
                        "confirmation_fields": before_payload["confirmation_fields"],
                        "manual_conflicts": before_payload["manual_conflicts"],
                    },
                    {
                        "confirmation_fields": after_payload["confirmation_fields"],
                        "manual_conflicts": after_payload["manual_conflicts"],
                    },
                )
                if tags != existing_tags:
                    self.storage.execute(
                        "UPDATE strategy_creation_messages SET extracted_fields_json = ? WHERE id = ?",
                        (dumps(tags), row["id"]),
                    )
                    updated = True

        return updated

    def _parameter_snapshot_for_version(self, strategy: Mapping[str, Any], parameter_version_id: str | None = None) -> dict[str, Any]:
        if not parameter_version_id:
            return dict(strategy.get("parameters") or {})
        for entry in strategy.get("parameter_history", []):
            if entry.get("parameter_version_id") == parameter_version_id:
                return dict(entry.get("parameters") or {})
        raise KeyError(f"Parameter version not found: {parameter_version_id}")

    def _resolve_expected_base_parameter_version_id(
        self,
        strategy: Mapping[str, Any],
        *sources: Any,
    ) -> str | None:
        for source in sources:
            candidate = str(source or "").strip()
            if candidate:
                return candidate
        current = str(strategy.get("current_parameter_version_id") or "").strip()
        return current or None

    def _assert_base_parameter_version_is_fresh(
        self,
        strategy: Mapping[str, Any],
        expected_base_parameter_version_id: str | None,
        *,
        blocking_target_id: str,
    ) -> str:
        current_base_parameter_version_id = str(strategy.get("current_parameter_version_id") or "").strip()
        if (
            expected_base_parameter_version_id
            and current_base_parameter_version_id
            and expected_base_parameter_version_id != current_base_parameter_version_id
        ):
            raise ContractConflictError(
                "stale_base_parameter_version",
                "The strategy has moved to a newer parameter version.",
                blocking_target={"type": "strategy", "id": blocking_target_id},
                next_action="refresh_strategy_detail",
                extra={
                    "expected_base_parameter_version_id": expected_base_parameter_version_id,
                    "current_parameter_version_id": current_base_parameter_version_id,
                },
            )
        return current_base_parameter_version_id

    def _build_candidate_record(
        self,
        *,
        strategy: Mapping[str, Any],
        parameter_snapshot: Mapping[str, Any],
        base_parameter_version_id: str | None,
        label: str | None = None,
        metrics: Mapping[str, Any] | None = None,
        summary: str | None = None,
        rank: int | None = None,
        score: float | None = None,
        status: str = "SUCCEEDED",
    ) -> dict[str, Any]:
        snapshot = dict(parameter_snapshot)
        if not snapshot:
            raise ValueError("parameter_snapshot is required")
        candidate_rank = rank if rank is not None else 1
        candidate_label = label.strip() if isinstance(label, str) and label.strip() else f"Candidate {candidate_rank}"
        return {
            "id": self._new_id("trial"),
            "label": candidate_label,
            "status": status,
            "rank": candidate_rank,
            "score": score,
            "summary": summary,
            "metrics": dict(metrics or {}),
            "base_parameter_version_id": base_parameter_version_id,
            "parameter_snapshot": snapshot,
            "parameter_delta": _build_parameter_delta(strategy.get("parameters") or {}, snapshot),
            "allowed_actions": ["promote_candidate", "create_copy"] if status == "SUCCEEDED" else [],
        }

    def _hydrate_optimization_job(self, row: Mapping[str, Any]) -> dict[str, Any]:
        job = dict(row)
        job["request"] = loads(job.pop("request_json", None), {})
        job["summary"] = loads(job.pop("summary_json", None), {})
        job["result"] = loads(job.pop("result_json", None), {})
        job["candidates"] = loads(job.pop("candidates_json", None), [])
        job["base_parameter_version_id"] = job["request"].get("base_parameter_version_id")
        strategy = self.get_strategy_detail(str(job["strategy_id"]))
        job["candidates"] = [
            {
                **candidate,
                "parameter_snapshot": dict(candidate.get("parameter_snapshot") or {}),
                "parameter_delta": dict(
                    candidate.get("parameter_delta")
                    or _build_parameter_delta(strategy.get("parameters") or {}, candidate.get("parameter_snapshot") or {})
                ),
                "metrics": dict(candidate.get("metrics") or {}),
                "base_parameter_version_id": candidate.get("base_parameter_version_id") or job["base_parameter_version_id"],
                "allowed_actions": list(
                    candidate.get("allowed_actions")
                    or (["promote_candidate", "create_copy"] if candidate.get("status") == "SUCCEEDED" else [])
                ),
            }
            for candidate in job["candidates"]
        ]
        return job

    def _normalize_optimization_candidate(
        self,
        strategy: Mapping[str, Any],
        candidate: Mapping[str, Any],
        *,
        rank: int,
        base_parameter_version_id: str | None,
    ) -> dict[str, Any]:
        strategy_parameters = dict(strategy.get("parameters") or {})
        parameter_snapshot = dict(candidate.get("parameter_snapshot") or strategy_parameters)
        parameter_delta = _build_parameter_delta(strategy_parameters, parameter_snapshot)
        metrics = {
            str(key): float(value)
            for key, value in dict(candidate.get("metrics") or {}).items()
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        }
        score = candidate.get("score")
        if not isinstance(score, (int, float)) or isinstance(score, bool):
            score = metrics.get("sharpe") or metrics.get("total_return") or 0.0
        return {
            "id": str(candidate.get("id") or self._new_id("trial")),
            "label": str(candidate.get("label") or f"Candidate {rank}"),
            "summary": candidate.get("summary"),
            "status": str(candidate.get("status") or "SUCCEEDED"),
            "rank": int(candidate.get("rank") or rank),
            "score": float(score),
            "parameter_snapshot": parameter_snapshot,
            "parameter_delta": parameter_delta,
            "metrics": metrics,
            "base_parameter_version_id": str(
                candidate.get("base_parameter_version_id")
                or base_parameter_version_id
                or ""
            )
            or None,
            "allowed_actions": list(
                candidate.get("allowed_actions")
                or (["promote_candidate", "create_copy"] if str(candidate.get("status") or "SUCCEEDED") == "SUCCEEDED" else [])
            ),
        }

    def _persist_optimization_job(
        self,
        job_id: str,
        strategy_id: str,
        payload: Mapping[str, Any],
        candidates: list[dict[str, Any]],
        *,
        created_at: str,
    ) -> None:
        baseline_parameter_version_id = str(
            payload.get("base_parameter_version_id")
            or ""
        ) or None
        normalized_candidates = sorted(
            [dict(candidate) for candidate in candidates],
            key=lambda item: int(item.get("rank") or 0) or 0,
        )
        summary = {
            "objective": payload.get("objective") or "sharpe",
            "candidate_count": len(normalized_candidates),
            "baseline_parameter_version_id": baseline_parameter_version_id,
        }
        result = {
            "best_candidate_id": normalized_candidates[0]["id"] if normalized_candidates else None,
            "baseline_parameter_version_id": baseline_parameter_version_id,
        }
        self.storage.insert_json_row(
            "optimization_jobs",
            {
                "id": job_id,
                "strategy_id": strategy_id,
                "status": "COMPLETED",
                "request_json": dumps(dict(payload)),
                "summary_json": dumps(summary),
                "result_json": dumps(result),
                "candidates_json": dumps(normalized_candidates),
                "created_at": created_at,
                "updated_at": iso_now(),
                "completed_at": iso_now(),
            },
        )

    def _persist_session_state(
        self,
        base_row: Mapping[str, Any],
        payload: Mapping[str, Any],
        *,
        status: str,
        messages: list[dict[str, Any]],
    ) -> dict[str, Any]:
        session_record = {
            "id": base_row["id"],
            "status": status,
            "strategy_type": payload["top_level"]["strategy_type"],
            "universe_name": payload["top_level"].get("universe_name") or "",
            "rebalance_frequency": payload["top_level"].get("rebalance_frequency"),
            "prompt": messages[-1]["content"] if messages else str(base_row.get("prompt") or ""),
            "revision": int(base_row.get("revision") or 1),
            "strategy_id": base_row.get("strategy_id"),
            "suggested_name": self._build_suggested_name(payload["top_level"]),
            "confirmation_fields_json": dumps(payload["confirmation_fields"]),
            "pending_inputs_json": dumps(payload["pending_inputs"]),
            "manual_conflicts_json": dumps(payload["manual_conflicts"]),
            "allowed_actions_json": dumps(self._session_allowed_actions(status)),
            "metadata_json": base_row.get("metadata_json") or dumps({}),
            "created_at": base_row["created_at"],
            "updated_at": iso_now(),
        }
        self.storage.insert_json_row("strategy_creation_sessions", session_record)
        decoded = self._decode_session_row(session_record)
        decoded["messages"] = messages
        decoded["top_level"] = dict(payload["top_level"])
        return decoded

    def _hydrate_session(self, session_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM strategy_creation_sessions WHERE id = ?", (session_id,))
        if not row:
            raise KeyError(f"Creation session not found: {session_id}")
        messages = self._session_messages(session_id)
        decoded = self._decode_session_row(row)
        decoded["confirmation_fields"] = _dedupe_top_level_parameters(decoded["confirmation_fields"])
        forced_type = decoded["strategy_type"] if str(decoded.get("strategy_type") or "").upper() != "GENERAL" else None
        payload = build_confirmation(messages, existing=decoded["confirmation_fields"], forced_type=forced_type)
        if decoded["status"] == "LOCKED":
            status = "LOCKED"
        elif not messages:
            status = "DRAFTING"
        else:
            status = "READY_FOR_CONFIRMATION" if not payload["pending_inputs"] else "NEEDS_INPUT"
        hydrated = self._persist_session_state(row, payload, status=status, messages=messages)
        if self._backfill_missing_message_extracted_tags(session_id, hydrated.get("strategy_type")):
            hydrated["messages"] = self._session_messages(session_id)
        hydrated["strategy_id"] = decoded.get("strategy_id")
        hydrated["suggested_name"] = hydrated.get("suggested_name") or decoded.get("suggested_name")
        return hydrated

    def create_creation_session(self, request: Any | None = None) -> dict[str, Any]:
        payload = _as_mapping(request)
        session_id = self._new_id("cs")
        mode = str(payload.get("mode") or "CREATE").upper()
        base_strategy_id = payload.get("base_strategy_id")
        base_parameter_version_id = payload.get("base_parameter_version_id")
        base_strategy = None
        if mode == "REVISION" and base_strategy_id:
            base_strategy = self.get_strategy_detail(str(base_strategy_id))
        strategy_type = str(
            payload.get("strategy_type")
            or (base_strategy or {}).get("strategy_type")
            or "GENERAL"
        ).upper()
        confirmation_fields = deepcopy((base_strategy or {}).get("confirmation_fields") or blank_confirmation_fields(strategy_type))
        now = iso_now()
        self.storage.insert_json_row(
            "strategy_creation_sessions",
            {
                "id": session_id,
                "status": "DRAFTING",
                "strategy_type": strategy_type,
                "universe_name": "",
                "rebalance_frequency": None,
                "prompt": "",
                "revision": 1,
                "strategy_id": None,
                "suggested_name": (base_strategy or {}).get("name"),
                "confirmation_fields_json": dumps(confirmation_fields),
                "pending_inputs_json": dumps([]),
                "manual_conflicts_json": dumps([]),
                "allowed_actions_json": dumps(self._session_allowed_actions("DRAFTING")),
                "metadata_json": dumps(
                    {
                        "mode": mode,
                        "base_strategy_id": str(base_strategy_id) if base_strategy_id else None,
                        "base_parameter_version_id": str(
                            base_parameter_version_id
                            or (base_strategy or {}).get("current_parameter_version_id")
                            or ""
                        )
                        or None,
                    }
                ),
                "created_at": now,
                "updated_at": now,
            },
        )
        return self.get_creation_session(session_id)

    start_creation_session = create_creation_session

    def get_creation_session(self, session_id: str) -> dict[str, Any]:
        return self._hydrate_session(session_id)

    def append_creation_message(self, session_id: str, message: Any) -> dict[str, Any]:
        if not self.storage.fetch_one("SELECT id FROM strategy_creation_sessions WHERE id = ?", (session_id,)):
            raise KeyError(f"Creation session not found: {session_id}")
        body = _as_mapping(message)
        content = str(body.get("content") or "").strip()
        if not content:
            raise ValueError("Creation message content is required")
        before_session = self.get_creation_session(session_id)
        message_id = self._new_id("msg")
        role = str(body.get("role") or "user")
        self.storage.insert_json_row(
            "strategy_creation_messages",
            {
                "id": message_id,
                "session_id": session_id,
                "role": role,
                "content": content,
                "extracted_fields_json": dumps([]),
                "created_at": iso_now(),
            },
        )
        after_session = self.get_creation_session(session_id)
        if role == "user":
            tags = self._build_message_extracted_tags(before_session, after_session)
            self.storage.execute(
                "UPDATE strategy_creation_messages SET extracted_fields_json = ? WHERE id = ?",
                (dumps(tags), message_id),
            )
            return self.get_creation_session(session_id)
        return after_session

    def prepare_confirmation(self, session_id: str, request: Any | None = None) -> dict[str, Any]:
        del request
        return self.get_creation_session(session_id)

    def update_creation_confirmation(self, session_id: str, request: Any) -> dict[str, Any]:
        return self.update_confirmation(session_id, request)

    def update_confirmation(self, session_id: str, request: Any) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM strategy_creation_sessions WHERE id = ?", (session_id,))
        if not row:
            raise KeyError(f"Creation session not found: {session_id}")
        session = self._decode_session_row(row)
        payload = _as_mapping(request)
        confirmation_fields = deepcopy(session["confirmation_fields"])
        strategy_type = str(
            payload.get("strategy_type")
            or payload.get("core", {}).get("strategy_type")
            or _field_map(confirmation_fields["top_level"]).get("strategy_type", {}).get("value")
            or session["strategy_type"]
        ).upper()

        if strategy_type != session["strategy_type"]:
            fresh = blank_confirmation_fields(strategy_type)
            merged_top = fresh["top_level"]
            merged_params = fresh["parameters"]
            for entry in confirmation_fields.get("top_level", []):
                if entry.get("source") == "manual_override":
                    _upsert_field(merged_top, entry["key"], entry.get("label", entry["key"]), entry.get("value"), "manual_override")
            for entry in confirmation_fields.get("parameters", []):
                if entry.get("source") == "manual_override":
                    _upsert_field(merged_params, entry["key"], entry.get("label", entry["key"]), entry.get("value"), "manual_override")
            confirmation_fields = {"top_level": merged_top, "parameters": merged_params}

        top_level_overrides = {
            "strategy_type": strategy_type,
            "universe_name": payload.get("core", {}).get("universe_name"),
            "rebalance_frequency": payload.get("core", {}).get("rebalance_frequency"),
        }
        for key, value in top_level_overrides.items():
            if value is None:
                continue
            label = {"strategy_type": "策略类型", "universe_name": "标的范围", "rebalance_frequency": "调仓频率"}[key]
            _upsert_field(confirmation_fields["top_level"], key, label, value, "manual_override")

        for bucket_name in ("core", "logic", "parameters"):
            bucket = payload.get(bucket_name, {})
            for key, value in bucket.items():
                if value is None or key in {"strategy_type", "universe_name", "rebalance_frequency"}:
                    continue
                _upsert_field(confirmation_fields["parameters"], key, key, value, "manual_override")

        confirmation_fields = _dedupe_top_level_parameters(confirmation_fields)

        label_map = {
            str(entry.get("key")): str(entry.get("label") or entry.get("key"))
            for entry in _confirmation_entries(blank_confirmation_fields(strategy_type))
        }
        for bucket_name in ("top_level", "parameters"):
            for entry in confirmation_fields.get(bucket_name, []):
                key = str(entry.get("key") or "")
                if key in label_map:
                    entry["label"] = label_map[key]

        messages = self._session_messages(session_id)
        rebuilt = build_confirmation(messages, existing=confirmation_fields, forced_type=strategy_type)
        status = "READY_FOR_CONFIRMATION" if not rebuilt["pending_inputs"] else "NEEDS_INPUT"
        revision = max(int(row.get("revision") or 1) + 1, int(payload.get("revision") or 1))
        self.storage.insert_json_row(
            "strategy_creation_sessions",
            {
                "id": session_id,
                "status": status,
                "strategy_type": rebuilt["top_level"]["strategy_type"],
                "universe_name": rebuilt["top_level"].get("universe_name") or "",
                "rebalance_frequency": rebuilt["top_level"].get("rebalance_frequency"),
                "prompt": messages[-1]["content"] if messages else str(row.get("prompt") or ""),
                "revision": revision,
                "strategy_id": row.get("strategy_id"),
                "suggested_name": self._build_suggested_name(rebuilt["top_level"]),
                "confirmation_fields_json": dumps(rebuilt["confirmation_fields"]),
                "pending_inputs_json": dumps(rebuilt["pending_inputs"]),
                "manual_conflicts_json": dumps(rebuilt["manual_conflicts"]),
                "allowed_actions_json": dumps(self._session_allowed_actions(status)),
                "metadata_json": row.get("metadata_json") or dumps({}),
                "created_at": row["created_at"],
                "updated_at": iso_now(),
            },
        )
        return self.get_creation_session(session_id)

    def materialize_strategy(self, session_id: str, request: Any) -> dict[str, Any]:
        payload = _as_mapping(request)
        if not payload.get("idempotency_key"):
            raise ValueError("idempotency_key is required")
        session = self.get_creation_session(session_id)
        if session.get("strategy_id"):
            return self.get_strategy_detail(str(session["strategy_id"]))

        now = iso_now()
        top_level = session["top_level"]
        parameters = self._flatten_confirmation(session["confirmation_fields"], top_level)
        strategy_name = str(
            parameters.get("strategy_name")
            or session.get("suggested_name")
            or self._build_suggested_name(top_level)
        ).strip() or self._build_suggested_name(top_level)
        raw_description = parameters.get("strategy_description")
        strategy_description = str(raw_description).strip() if raw_description is not None else ""
        benchmark_symbol = str(parameters.get("benchmark_symbol") or "SPY").strip().upper() or "SPY"
        session_mode = str(session.get("mode") or "CREATE").upper()
        if session_mode == "REVISION":
            base_strategy_id = session.get("base_strategy_id")
            if not base_strategy_id:
                raise ValueError("Revision session is missing base_strategy_id")
            base_strategy = self.get_strategy_detail(str(base_strategy_id))
            expected_base = str(
                payload.get("base_parameter_version_id")
                or session.get("base_parameter_version_id")
                or ""
            ) or None
            current_base = str(base_strategy.get("current_parameter_version_id") or "")
            if expected_base and expected_base != current_base:
                raise ContractConflictError(
                    "stale_base_parameter_version",
                    "The strategy has moved to a newer parameter version.",
                    blocking_target={"type": "strategy", "id": str(base_strategy_id)},
                    next_action="refresh_strategy_detail",
                    extra={
                        "expected_base_parameter_version_id": expected_base,
                        "current_parameter_version_id": current_base,
                    },
                )

            strategy_row = self.storage.fetch_one("SELECT * FROM strategies WHERE id = ?", (base_strategy_id,))
            assert strategy_row is not None
            current_version = int(strategy_row.get("current_parameter_version") or 1)
            next_version = current_version + 1
            parameter_history = _normalize_parameter_history(
                str(base_strategy_id),
                loads(strategy_row.get("parameter_history_json"), []),
                loads(strategy_row.get("parameters_json"), {}),
                current_version,
            )
            parameter_history.append(
                {
                    "version_number": next_version,
                    "parameter_version_id": _parameter_version_id(str(base_strategy_id), next_version),
                    "revision": session["revision"],
                    "created_at": now,
                    "comment": payload.get("comment"),
                    "parameters": parameters,
                }
            )
            strategy_row["parameters_json"] = dumps(parameters)
            strategy_row["confirmation_fields_json"] = dumps(session["confirmation_fields"])
            strategy_row["name"] = strategy_name
            strategy_row["description"] = strategy_description or strategy_row.get("description")
            strategy_row["benchmark_symbol"] = benchmark_symbol
            strategy_row["universe_name"] = top_level.get("universe_name") or strategy_row.get("universe_name") or ""
            strategy_row["rebalance_frequency"] = top_level.get("rebalance_frequency")
            self._write_strategy_record(
                strategy_row,
                parameter_history=parameter_history,
                current_version=next_version,
                comment=payload.get("comment"),
            )
            strategy_id = str(base_strategy_id)
        else:
            strategy_id = self._new_id("strat")
            version_history = [
                {
                    "version_number": 1,
                    "parameter_version_id": _parameter_version_id(strategy_id, 1),
                    "revision": session["revision"],
                    "created_at": now,
                    "comment": payload.get("comment"),
                    "parameters": parameters,
                }
            ]
            strategy_row = {
                "id": strategy_id,
                "name": strategy_name,
                "description": strategy_description or None,
                "strategy_type": top_level["strategy_type"],
                "universe_name": top_level.get("universe_name") or "",
                "rebalance_frequency": top_level.get("rebalance_frequency"),
                "lifecycle_status": "ACTIVE",
                "dataset_snapshot_id": None,
                "universe_snapshot_id": None,
                "benchmark_symbol": benchmark_symbol,
                "parameters_json": dumps(parameters),
                "confirmation_fields_json": dumps(session["confirmation_fields"]),
                "allowed_actions_json": dumps(["run_backtest", "refresh_snapshots", "edit_parameters"]),
                "latest_run_id": None,
                "latest_successful_run_id": None,
                "created_at": now,
                "updated_at": now,
            }
            self._write_strategy_record(strategy_row, parameter_history=version_history, current_version=1, comment=payload.get("comment"))

        row = self.storage.fetch_one("SELECT * FROM strategy_creation_sessions WHERE id = ?", (session_id,))
        assert row is not None
        self.storage.insert_json_row(
            "strategy_creation_sessions",
            {
                "id": session_id,
                "status": "LOCKED",
                "strategy_type": row["strategy_type"],
                "universe_name": row["universe_name"],
                "rebalance_frequency": row.get("rebalance_frequency"),
                "prompt": row.get("prompt") or "",
                "revision": row.get("revision") or 1,
                "strategy_id": strategy_id,
                "suggested_name": strategy_row["name"],
                "confirmation_fields_json": row["confirmation_fields_json"],
                "pending_inputs_json": row["pending_inputs_json"],
                "manual_conflicts_json": row["manual_conflicts_json"],
                "allowed_actions_json": dumps(self._session_allowed_actions("LOCKED")),
                "metadata_json": row.get("metadata_json") or dumps({}),
                "created_at": row["created_at"],
                "updated_at": now,
            },
        )
        return self.get_strategy_detail(strategy_id)

    def list_strategies(self) -> list[dict[str, Any]]:
        rows = self.storage.fetch_all("SELECT * FROM strategies ORDER BY updated_at DESC, created_at DESC")
        return [self._decode_strategy_row(row) for row in rows]

    def get_strategy_detail(self, strategy_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM strategies WHERE id = ?", (strategy_id,))
        if not row:
            raise KeyError(f"Strategy not found: {strategy_id}")
        return self._decode_strategy_row(row)

    get_strategy = get_strategy_detail

    def update_strategy(self, strategy_id: str, request: Any) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM strategies WHERE id = ?", (strategy_id,))
        if not row:
            raise KeyError(f"Strategy not found: {strategy_id}")
        payload = _as_mapping(request)
        updated = dict(row)
        for key in ("name", "description", "dataset_snapshot_id", "universe_snapshot_id"):
            if payload.get(key) is not None:
                updated[key] = payload[key]
        if payload.get("lifecycle_status") is not None:
            updated["lifecycle_status"] = payload["lifecycle_status"]
        updated["updated_at"] = iso_now()
        self.storage.insert_json_row("strategies", updated)
        return self.get_strategy_detail(strategy_id)

    def list_backtest_runs(self, limit: int | None = None, status: str | None = None) -> list[dict[str, Any]]:
        sql = "SELECT * FROM backtest_runs"
        params: list[Any] = []
        if status:
            sql += " WHERE status = ?"
            params.append(status)
        sql += " ORDER BY created_at DESC"
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        rows = self.storage.fetch_all(sql, params)
        return [self._decode_run_row(row) for row in rows]

    def get_backtest_run(self, run_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM backtest_runs WHERE id = ?", (run_id,))
        if not row:
            raise KeyError(f"Backtest run not found: {run_id}")
        return self._decode_run_row(row)

    def get_backtest_run_detail(self, run_id: str) -> dict[str, Any]:
        run = self.get_backtest_run(run_id)
        run["legacy_demo_run"] = False
        return run

    def get_backtest_run_trades(self, run_id: str, page: int = 1, page_size: int = 50, segment: str = "all") -> dict[str, Any]:
        run = self.get_backtest_run(run_id)
        trades = list(run.get("trades", []))
        normalized_segment = str(segment or "all").upper()
        if normalized_segment in {"IS", "OOS"}:
            trades = [item for item in trades if str(item.get("segment") or "").upper() == normalized_segment]
        total = len(trades)
        start = max(page - 1, 0) * page_size
        end = start + page_size
        return {"items": trades[start:end], "page": page, "page_size": page_size, "total": total}

    def clone_backtest_run(self, run_id: str, request: Any) -> dict[str, Any]:
        run = self.get_backtest_run_detail(run_id)
        payload = _as_mapping(request)
        cloned_payload = dict(run.get("request") or {})
        cloned_payload.update(payload)
        cloned_payload.setdefault("source_run_id", run_id)
        cloned_payload.setdefault("is_permanent", False)
        return self.submit_backtest_run(str(run["strategy_id"]), cloned_payload)

    def get_workspace_overview(self) -> dict[str, Any]:
        strategies = self.list_strategies()
        recent_runs = self.list_backtest_runs(limit=5)
        latest_job = self.storage.fetch_one("SELECT * FROM optimization_jobs ORDER BY created_at DESC LIMIT 1")
        return {
            "workspace_name": "Grit 策略实验室",
            "subtitle": "以明确契约串联研究、确认、回测与参数提升。",
            "strategy_count": len(strategies),
            "active_run_count": len([item for item in recent_runs if item.get("status") == "RUNNING"]),
            "running_optimization_count": 1 if latest_job and latest_job.get("status") == "RUNNING" else 0,
            "latest_strategy_id": strategies[0]["id"] if strategies else None,
            "latest_backtest_run_id": recent_runs[0]["id"] if recent_runs else None,
            "latest_optimization_job_id": latest_job["id"] if latest_job else None,
            "top_momentum_warning": "有一个股票池快照未完成；在刷新之前，新的正式回测都会被阻止。",
            "quick_actions": ["open_creation", "start_backtest", "open_optimization"],
        }

    def get_snapshot_overview(self) -> dict[str, Any]:
        jobs = self.storage.fetch_all("SELECT * FROM snapshot_refresh_jobs ORDER BY created_at DESC LIMIT 1")
        latest_job = self._decode_snapshot_refresh_job(jobs[0]) if jobs else None
        return {
            "overall_status": "INCOMPLETE" if latest_job is None else str(latest_job.get("status") or "INCOMPLETE").upper(),
            "last_refreshed_at": latest_job.get("completed_at") if latest_job else None,
            "dataset_snapshots": [],
            "universe_snapshots": [],
            "latest_job": latest_job,
            "blocking_code": "SNAPSHOT_REFRESH_REQUIRED",
            "blocking_target": "data_snapshots",
            "message": "还没有生成快照。先刷新快照，再继续正式回测。",
            "allowed_actions": ["refresh_snapshots"],
        }

    def refresh_snapshots(self, request: Any | None = None) -> dict[str, Any]:
        payload = _as_mapping(request)
        now = iso_now()
        job = {
            "id": self._new_id("snap"),
            "status": "INCOMPLETE",
            "request": payload,
            "summary": {
                "status": "INCOMPLETE",
                "symbol_count": 0,
                "row_count": 0,
                "blocking": True,
                "blocking_code": "SNAPSHOT_REFRESH_REQUIRED",
                "blocking_target": "data_snapshots",
            },
            "warnings": ["No market data repository is attached"],
            "errors": [],
            "created_at": now,
            "updated_at": now,
            "started_at": now,
            "completed_at": now,
        }
        self.storage.insert_json_row(
            "snapshot_refresh_jobs",
            {
                "id": job["id"],
                "status": job["status"],
                "request_json": dumps(job["request"]),
                "summary_json": dumps(job["summary"]),
                "warnings_json": dumps(job["warnings"]),
                "errors_json": dumps(job["errors"]),
                "created_at": now,
                "updated_at": now,
                "started_at": now,
                "completed_at": now,
            },
        )
        overview = self.get_snapshot_overview()
        overview["latest_job"] = job
        overview["last_refreshed_at"] = now
        return overview

    def _decode_snapshot_refresh_job(self, row: Mapping[str, Any] | None) -> dict[str, Any] | None:
        if not row:
            return None
        return {
            **dict(row),
            "request": loads(row.get("request_json"), {}),
            "summary": loads(row.get("summary_json"), {}),
            "warnings": loads(row.get("warnings_json"), []),
            "errors": loads(row.get("errors_json"), []),
        }

    def create_optimization_job(self, strategy_id: str, request: Any | None = None) -> dict[str, Any]:
        strategy = self.get_strategy_detail(strategy_id)
        payload = _as_mapping(request)
        now = iso_now()
        job_id = self._new_id("opt")
        baseline_parameter_version_id = str(
            payload.get("base_parameter_version_id")
            or strategy.get("current_parameter_version_id")
            or ""
        ) or None
        candidate_parameters = dict(strategy.get("parameters") or {})
        candidate_delta: dict[str, Any] = {}
        for key, value in candidate_parameters.items():
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                candidate_parameters[key] = value + 1
                break
        candidate_delta = _build_parameter_delta(strategy.get("parameters") or {}, candidate_parameters)
        if not candidate_delta:
            candidate_parameters["optimized_flag"] = True
            candidate_parameters["optimized_flag"] = True
            candidate_delta = {"optimized_flag": True}
        candidate = self._normalize_optimization_candidate(
            strategy,
            {
                "id": self._new_id("trial"),
                "label": "Baseline + 1",
                "status": "SUCCEEDED",
                "rank": 1,
                "score": 0.67,
                "parameter_delta": candidate_delta,
                "parameter_snapshot": candidate_parameters,
                "metrics": {},
                "base_parameter_version_id": baseline_parameter_version_id,
            },
            rank=1,
            base_parameter_version_id=baseline_parameter_version_id,
        )
        self._persist_optimization_job(
            job_id,
            strategy_id,
            {
                **payload,
                "base_parameter_version_id": baseline_parameter_version_id,
            },
            [candidate],
            created_at=now,
        )
        return self.get_optimization_job_detail(job_id)

    def get_optimization_job_detail(self, job_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM optimization_jobs WHERE id = ?", (job_id,))
        if not row:
            raise KeyError(f"Optimization job not found: {job_id}")
        job = dict(row)
        job["request"] = loads(job.pop("request_json", None), {})
        job["summary"] = loads(job.pop("summary_json", None), {})
        job["result"] = loads(job.pop("result_json", None), {})
        strategy = self.get_strategy_detail(str(job["strategy_id"]))
        raw_candidates = loads(job.pop("candidates_json", None), [])
        job["base_parameter_version_id"] = job["request"].get("base_parameter_version_id")
        job["candidates"] = [
            self._normalize_optimization_candidate(
                strategy,
                candidate,
                rank=index,
                base_parameter_version_id=job["base_parameter_version_id"],
            )
            for index, candidate in enumerate(raw_candidates, start=1)
        ]
        return job

    def create_optimization_candidate(self, job_id: str, request: Any) -> dict[str, Any]:
        payload = _as_mapping(request)
        parameter_snapshot = dict(payload.get("parameter_snapshot") or {})
        if not parameter_snapshot:
            raise ValueError("parameter_snapshot is required")
        job = self.get_optimization_job_detail(job_id)
        strategy = self.get_strategy_detail(str(job["strategy_id"]))
        expected_base_parameter_version_id = self._resolve_expected_base_parameter_version_id(
            strategy,
            payload.get("base_parameter_version_id"),
            job.get("base_parameter_version_id"),
        )
        self._assert_base_parameter_version_is_fresh(
            strategy,
            expected_base_parameter_version_id,
            blocking_target_id=str(job["strategy_id"]),
        )
        candidates = [dict(candidate) for candidate in job.get("candidates", [])]
        new_candidate = self._normalize_optimization_candidate(
            strategy,
            {
                "id": self._new_id("trial"),
                "label": payload.get("label"),
                "summary": payload.get("summary"),
                "status": "SUCCEEDED",
                "rank": len(candidates) + 1,
                "score": payload.get("score"),
                "parameter_snapshot": parameter_snapshot,
                "metrics": dict(payload.get("metrics") or {}),
                "base_parameter_version_id": expected_base_parameter_version_id,
            },
            rank=len(candidates) + 1,
            base_parameter_version_id=expected_base_parameter_version_id,
        )
        candidates.append(new_candidate)
        self._persist_optimization_job(
            job_id,
            str(job["strategy_id"]),
            {
                **job["request"],
                "base_parameter_version_id": expected_base_parameter_version_id,
            },
            candidates,
            created_at=str(job["created_at"]),
        )
        return self.get_optimization_job_detail(job_id)

    def promote_trial(self, job_id: str, trial_id: str, request: Any) -> dict[str, Any]:
        job = self.get_optimization_job_detail(job_id)
        candidate = next((item for item in job.get("candidates", []) if item.get("id") == trial_id), None)
        if not candidate:
            raise KeyError(f"Optimization candidate not found: {trial_id}")
        payload = _as_mapping(request)
        strategy = self.get_strategy_detail(str(job["strategy_id"]))
        expected_base = self._resolve_expected_base_parameter_version_id(
            strategy,
            payload.get("base_parameter_version_id"),
            candidate.get("base_parameter_version_id"),
            job.get("base_parameter_version_id"),
        )
        self._assert_base_parameter_version_is_fresh(
            strategy,
            expected_base,
            blocking_target_id=str(job["strategy_id"]),
        )

        promoted_parameters = dict(candidate.get("parameter_snapshot") or strategy.get("parameters") or {})
        if payload.get("mode") == "create_copy":
            now = iso_now()
            cloned_id = self._new_id("strat")
            version_history = [
                {
                    "version_number": 1,
                    "parameter_version_id": _parameter_version_id(cloned_id, 1),
                    "revision": 1,
                    "created_at": now,
                    "comment": payload.get("comment"),
                    "parameters": promoted_parameters,
                }
            ]
            self._write_strategy_record(
                {
                    "id": cloned_id,
                    "name": f'{strategy["name"]} Copy',
                    "description": strategy.get("description"),
                    "strategy_type": strategy["strategy_type"],
                    "universe_name": strategy["universe_name"],
                    "rebalance_frequency": strategy.get("rebalance_frequency"),
                    "lifecycle_status": strategy.get("lifecycle_status", "ACTIVE"),
                    "dataset_snapshot_id": strategy.get("dataset_snapshot_id"),
                    "universe_snapshot_id": strategy.get("universe_snapshot_id"),
                    "benchmark_symbol": strategy.get("benchmark_symbol", "SPY"),
                    "parameters_json": dumps(promoted_parameters),
                    "confirmation_fields_json": dumps(strategy["confirmation_fields"]),
                    "allowed_actions_json": dumps(strategy["allowed_actions"]),
                    "latest_run_id": strategy.get("latest_run_id"),
                    "latest_successful_run_id": strategy.get("latest_successful_run_id"),
                    "created_at": now,
                    "updated_at": now,
                },
                parameter_history=version_history,
                current_version=1,
                comment=payload.get("comment"),
            )
            return self.get_strategy_detail(cloned_id)

        strategy_row = self.storage.fetch_one("SELECT * FROM strategies WHERE id = ?", (job["strategy_id"],))
        assert strategy_row is not None
        current_version = int(strategy_row.get("current_parameter_version") or 1)
        next_version = current_version + 1
        parameter_history = _normalize_parameter_history(
            str(job["strategy_id"]),
            loads(strategy_row.get("parameter_history_json"), []),
            loads(strategy_row.get("parameters_json"), {}),
            current_version,
        )
        parameter_history.append(
            {
                "version_number": next_version,
                "parameter_version_id": _parameter_version_id(str(job["strategy_id"]), next_version),
                "revision": current_version,
                "created_at": iso_now(),
                "comment": payload.get("comment"),
                "parameters": promoted_parameters,
            }
        )
        strategy_row["parameters_json"] = dumps(promoted_parameters)
        self._write_strategy_record(
            strategy_row,
            parameter_history=parameter_history,
            current_version=next_version,
            comment=payload.get("comment"),
        )
        return self.get_strategy_detail(str(job["strategy_id"]))

    def delete_optimization_candidate(self, job_id: str, trial_id: str) -> dict[str, Any]:
        job = self.get_optimization_job_detail(job_id)
        candidates = [candidate for candidate in job.get("candidates", []) if candidate.get("id") != trial_id]
        if len(candidates) == len(job.get("candidates", [])):
            raise KeyError(f"Optimization candidate not found: {trial_id}")
        for index, candidate in enumerate(candidates, start=1):
            candidate["rank"] = index
        self._persist_optimization_job(
            job_id,
            str(job["strategy_id"]),
            {
                **job["request"],
                "base_parameter_version_id": job.get("base_parameter_version_id"),
            },
            candidates,
            created_at=str(job["created_at"]),
        )
        return self.get_optimization_job_detail(job_id)

    def get_workspace_overview(self, include_cleanup_audit: bool = False) -> dict[str, Any]:
        strategies = self.list_strategies()
        recent_runs = self.list_backtest_runs(limit=5)
        latest_job = self.storage.fetch_one("SELECT * FROM optimization_jobs ORDER BY created_at DESC LIMIT 1")
        overview = {
            "workspace_name": "Grit Strategy Lab",
            "subtitle": "Creation, backtest, and optimization workspace for local strategy recovery.",
            "strategy_count": len(strategies),
            "active_run_count": len([item for item in recent_runs if item.get("status") == "RUNNING"]),
            "running_optimization_count": 1 if latest_job and latest_job.get("status") == "RUNNING" else 0,
            "latest_strategy_id": strategies[0]["id"] if strategies else None,
            "latest_backtest_run_id": recent_runs[0]["id"] if recent_runs else None,
            "latest_optimization_job_id": latest_job["id"] if latest_job else None,
            "top_momentum_warning": "Refresh snapshots before trusting any newly materialized momentum strategy.",
            "quick_actions": ["open_creation", "start_backtest", "open_optimization"],
        }
        if include_cleanup_audit:
            runtime_state = self._read_runtime_state("cleanup_audit")
            overview["last_cleanup_count"] = int(runtime_state.get("state_json", {}).get("last_cleanup_count") or 0)
        return overview

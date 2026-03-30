from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4

from .creation_templates import (
    DEFAULT_ALLOWED_ACTIONS,
    STRATEGY_TEMPLATES,
    merge_manual_overrides,
    refresh_creation_state,
    repair_creation_session,
)
from .storage import SQLiteStorage, dumps, iso_now, loads


SP500_UNIVERSE_KEY = "sp500"
SP500_UNIVERSE_NAME = "S&P 500"
SP500_UNIVERSE_SNAPSHOT_ID = "sp500_membership_history"


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


class BacktestPlatformService:
    def __init__(self, database_path: str | Path = "data/platform.sqlite3"):
        self.storage = SQLiteStorage(database_path)

    def _new_id(self, prefix: str) -> str:
        return f"{prefix}_{uuid4().hex[:12]}"

    def _decode_session(self, row: Mapping[str, Any] | None) -> dict[str, Any] | None:
        if row is None:
            return None
        session = dict(row)
        session["parameters"] = loads(session.pop("parameters_json", None), {})
        session["normalized_parameters"] = loads(session.pop("normalized_parameters_json", None), {})
        session["manual_overrides"] = loads(session.pop("manual_overrides_json", None), {})
        session["field_errors"] = loads(session.pop("field_errors_json", None), {})
        session["allowed_actions"] = loads(session.pop("allowed_actions_json", None), [])
        session["artifacts"] = loads(session.pop("artifacts_json", None), {})
        return repair_creation_session(session)

    def _decode_strategy(self, row: Mapping[str, Any]) -> dict[str, Any]:
        strategy = dict(row)
        strategy["allowed_actions"] = loads(strategy.pop("allowed_actions_json", None), [])
        strategy["notes"] = loads(strategy.pop("notes_json", None), {})
        strategy["parameter_versions"] = [
            self._decode_parameter_version(item) for item in self.storage.fetch_all(
                """
                SELECT * FROM strategy_parameter_versions
                WHERE strategy_id = ?
                ORDER BY version_number DESC, revision DESC
                """,
                (strategy["id"],),
            )
        ]
        return strategy

    def _decode_parameter_version(self, row: Mapping[str, Any]) -> dict[str, Any]:
        version = dict(row)
        version["parameters"] = loads(version.pop("parameters_json", None), {})
        version["normalized_parameters"] = loads(version.pop("normalized_parameters_json", None), {})
        version["manual_overrides"] = loads(version.pop("manual_overrides_json", None), {})
        version["field_errors"] = loads(version.pop("field_errors_json", None), {})
        version["diagnostics"] = loads(version.pop("diagnostics_json", None), {})
        return version

    def _decode_run(self, row: Mapping[str, Any]) -> dict[str, Any]:
        run = dict(row)
        run["warnings"] = loads(run.pop("warnings_json", None), [])
        run["request"] = loads(run.pop("request_json", None), {})
        run["preview"] = loads(run.pop("preview_json", None), {})
        run["result"] = loads(run.pop("result_json", None), {})
        run["metrics"] = loads(run.pop("metrics_json", None), {})
        run["parameter_snapshot"] = loads(run.pop("parameter_snapshot_json", None), {})
        run["environment_summary"] = loads(run.pop("environment_summary_json", None), {})
        run["relative_metrics"] = loads(run.pop("relative_metrics_json", None), {})
        run["consistency_score"] = loads(run.pop("consistency_score_json", None), {})
        run["risk_metrics"] = loads(run.pop("risk_metrics_json", None), {})
        run["drawdown_events"] = loads(run.pop("drawdown_events_json", None), [])
        run["rolling_metrics"] = loads(run.pop("rolling_metrics_json", None), {})
        run["monthly_returns"] = loads(run.pop("monthly_returns_json", None), [])
        return run

    def _normalize_run_status_filter(self, status: str | None) -> str | None:
        normalized = str(status or "").strip().lower()
        return normalized or None

    def _run_period(self, row: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "start_date": row.get("start_date"),
            "end_date": row.get("end_date"),
            "effective_date": row.get("effective_date"),
            "oos_start_date": row.get("oos_start_date"),
        }

    def _run_list_item(self, row: Mapping[str, Any]) -> dict[str, Any]:
        item = self._decode_run(row)
        item["period"] = self._run_period(item)
        return item

    def _backtest_run_list_rows(
        self,
        strategy_id: str | None = None,
        *,
        status: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        sql = "SELECT * FROM backtest_runs"
        filters: list[str] = []
        params: list[Any] = []
        if strategy_id:
            filters.append("strategy_id = ?")
            params.append(strategy_id)
        normalized_status = self._normalize_run_status_filter(status)
        if normalized_status:
            filters.append("status = ?")
            params.append(normalized_status)
        if filters:
            sql += " WHERE " + " AND ".join(filters)
        sql += " ORDER BY created_at DESC"
        if limit:
            sql += " LIMIT ?"
            params.append(limit)
        return self.storage.fetch_all(sql, params)

    def _clear_field_errors(self, session: Mapping[str, Any]) -> dict[str, Any]:
        cleaned = dict(session)
        cleaned["field_errors"] = {}
        return cleaned

    def start_creation_session(self, request: Any, template_key: str | None = None) -> dict[str, Any]:
        if isinstance(request, str):
            prompt = request
            payload = {}
        else:
            payload = _as_mapping(request)
            prompt = str(payload.get("prompt") or payload.get("content") or "")
            template_key = template_key or payload.get("template_key")
        session_id = self._new_id("cs")
        state = refresh_creation_state(prompt, template_key=template_key)
        now = iso_now()
        payload = {
            "id": session_id,
            "status": "draft",
            "prompt": prompt,
            "summary": state["summary"],
            "template_key": state["template_key"],
            "selected_template_key": state["selected_template_key"],
            "parameter_revision": state["parameter_revision"],
            "suggested_name": state["suggested_name"],
            "parameters_json": dumps(state["parameters"]),
            "normalized_parameters_json": dumps(state["normalized_parameters"]),
            "manual_overrides_json": dumps(state["manual_overrides"]),
            "field_errors_json": dumps(state["field_errors"]),
            "allowed_actions_json": dumps(state["allowed_actions"]),
            "artifacts_json": dumps(state["artifacts"]),
            "created_at": now,
            "updated_at": now,
        }
        self.storage.insert_json_row("creation_sessions", payload)
        return self.get_creation_session(session_id)

    create_creation_session = start_creation_session

    def get_creation_session(self, session_id: str) -> dict[str, Any]:
        session = self._decode_session(
            self.storage.fetch_one("SELECT * FROM creation_sessions WHERE id = ?", (session_id,))
        )
        if not session:
            raise KeyError(f"Creation session not found: {session_id}")
        session["messages"] = self.storage.fetch_all(
            "SELECT * FROM creation_messages WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,),
        )
        return session

    def refresh_creation_session(
        self,
        session_id: str,
        prompt: Any | None = None,
        template_key: str | None = None,
    ) -> dict[str, Any]:
        current = self.get_creation_session(session_id)
        request_payload = _as_mapping(prompt) if prompt is not None and not isinstance(prompt, str) else {}
        if request_payload.get("manual_overrides"):
            current = self.override_creation_fields(session_id, request_payload["manual_overrides"])
        next_prompt = (
            prompt
            if isinstance(prompt, str)
            else str(request_payload.get("prompt") or request_payload.get("content") or current.get("prompt") or "")
        )
        refreshed = refresh_creation_state(
            next_prompt,
            previous_state=current,
            template_key=template_key or request_payload.get("template_key") or current.get("template_key"),
        )
        payload = {
            "id": session_id,
            "strategy_id": current.get("strategy_id"),
            "status": current.get("status", "draft"),
            "prompt": next_prompt,
            "summary": refreshed["summary"],
            "template_key": refreshed["template_key"],
            "selected_template_key": refreshed["selected_template_key"],
            "parameter_revision": refreshed["parameter_revision"],
            "suggested_name": refreshed["suggested_name"],
            "parameters_json": dumps(refreshed["parameters"]),
            "normalized_parameters_json": dumps(refreshed["normalized_parameters"]),
            "manual_overrides_json": dumps(refreshed["manual_overrides"]),
            "field_errors_json": dumps(refreshed["field_errors"]),
            "allowed_actions_json": dumps(refreshed["allowed_actions"]),
            "artifacts_json": dumps(refreshed["artifacts"]),
            "created_at": current["created_at"],
            "updated_at": iso_now(),
        }
        self.storage.insert_json_row("creation_sessions", payload)
        return self.get_creation_session(session_id)

    def override_creation_fields(self, session_id: str, overrides: Mapping[str, Any]) -> dict[str, Any]:
        session = self.get_creation_session(session_id)
        manual_overrides = dict(session.get("manual_overrides") or {})
        manual_overrides.update(_as_mapping(overrides))
        parameters = merge_manual_overrides(session.get("normalized_parameters") or session.get("parameters") or {}, manual_overrides)
        payload = {
            "id": session_id,
            "strategy_id": session.get("strategy_id"),
            "status": session.get("status", "draft"),
            "prompt": session.get("prompt"),
            "summary": session.get("summary"),
            "template_key": session.get("template_key"),
            "selected_template_key": session.get("selected_template_key"),
            "parameter_revision": int(session.get("parameter_revision") or 0) + 1,
            "suggested_name": session.get("suggested_name"),
            "parameters_json": dumps(parameters),
            "normalized_parameters_json": dumps(parameters),
            "manual_overrides_json": dumps(manual_overrides),
            "field_errors_json": dumps({}),
            "allowed_actions_json": dumps(session.get("allowed_actions") or DEFAULT_ALLOWED_ACTIONS),
            "artifacts_json": dumps(session.get("artifacts") or {}),
            "created_at": session["created_at"],
            "updated_at": iso_now(),
        }
        self.storage.insert_json_row("creation_sessions", payload)
        return self.get_creation_session(session_id)

    def append_creation_message(self, session_id: str, message: Any) -> dict[str, Any]:
        body = _as_mapping(message)
        self.storage.insert_json_row(
            "creation_messages",
            {
                "id": self._new_id("msg"),
                "session_id": session_id,
                "role": body.get("role", "user"),
                "content": body.get("content", ""),
                "metadata_json": dumps(body.get("metadata", {})),
                "created_at": iso_now(),
            },
        )
        if body.get("refresh", True):
            return self.refresh_creation_session(session_id, prompt=body.get("content"))
        return self.get_creation_session(session_id)

    def prepare_confirmation(self, session_id: str, request: Any | None = None) -> dict[str, Any]:
        session = self.get_creation_session(session_id)
        overrides = _as_mapping(request).get("manual_overrides")
        if overrides:
            session = self.override_creation_fields(session_id, overrides)
        session["status"] = "ready_for_confirmation"
        self.storage.insert_json_row(
            "creation_sessions",
            {
                "id": session["id"],
                "strategy_id": session.get("strategy_id"),
                "status": "ready_for_confirmation",
                "prompt": session.get("prompt"),
                "summary": session.get("summary"),
                "template_key": session.get("template_key"),
                "selected_template_key": session.get("selected_template_key"),
                "parameter_revision": session.get("parameter_revision"),
                "suggested_name": session.get("suggested_name"),
                "parameters_json": dumps(session.get("parameters", {})),
                "normalized_parameters_json": dumps(session.get("normalized_parameters", {})),
                "manual_overrides_json": dumps(session.get("manual_overrides", {})),
                "field_errors_json": dumps(session.get("field_errors", {})),
                "allowed_actions_json": dumps(["materialize", "override_field", "discard"]),
                "artifacts_json": dumps(session.get("artifacts", {})),
                "created_at": session["created_at"],
                "updated_at": iso_now(),
            },
        )
        return self.get_creation_session(session_id)

    def materialize_strategy(self, request: Any) -> dict[str, Any]:
        payload = _as_mapping(request)
        session_id = payload.get("session_id")
        session = self.get_creation_session(session_id) if session_id else repair_creation_session(payload)
        strategy_id = self._new_id("strat")
        parameter_version_id = self._new_id("pv")
        now = iso_now()
        parameters = deepcopy(session.get("parameters") or {})
        template = STRATEGY_TEMPLATES.get(str(session.get("template_key") or ""), next(iter(STRATEGY_TEMPLATES.values())))
        strategy_name = payload.get("name") or session.get("suggested_name") or template.name
        self.storage.insert_json_row(
            "strategies",
            {
                "id": strategy_id,
                "name": strategy_name,
                "template_key": session.get("template_key"),
                "universe_key": parameters.get("universe_key", "sp500"),
                "benchmark_symbol": parameters.get("benchmark_symbol", "SPY"),
                "status": "active",
                "allowed_actions_json": dumps(["preview_backtest", "run_backtest", "clone", "optimize"]),
                "current_parameter_version_id": parameter_version_id,
                "current_parameter_version_number": 1,
                "current_parameter_revision": session.get("parameter_revision", 1),
                "latest_run_id": None,
                "latest_successful_run_id": None,
                "notes_json": dumps({"source_session_id": session_id}),
                "created_at": now,
                "updated_at": now,
            },
        )
        self.storage.insert_json_row(
            "strategy_parameter_versions",
            {
                "id": parameter_version_id,
                "strategy_id": strategy_id,
                "version_number": 1,
                "revision": session.get("parameter_revision", 1),
                "status": "confirmed",
                "source": "creation_session",
                "summary": session.get("summary"),
                "rationale": session.get("prompt"),
                "parameters_json": dumps(parameters),
                "normalized_parameters_json": dumps(session.get("normalized_parameters", parameters)),
                "manual_overrides_json": dumps(session.get("manual_overrides", {})),
                "field_errors_json": dumps({}),
                "diagnostics_json": dumps({"template_key": session.get("template_key")}),
                "created_at": now,
                "updated_at": now,
            },
        )
        if session_id:
            session["strategy_id"] = strategy_id
            session["status"] = "materialized"
            self.storage.insert_json_row(
                "creation_sessions",
                {
                    "id": session["id"],
                    "strategy_id": strategy_id,
                    "status": "materialized",
                    "prompt": session.get("prompt"),
                    "summary": session.get("summary"),
                    "template_key": session.get("template_key"),
                    "selected_template_key": session.get("selected_template_key"),
                    "parameter_revision": session.get("parameter_revision"),
                    "suggested_name": session.get("suggested_name"),
                    "parameters_json": dumps(session.get("parameters", {})),
                    "normalized_parameters_json": dumps(session.get("normalized_parameters", {})),
                    "manual_overrides_json": dumps(session.get("manual_overrides", {})),
                    "field_errors_json": dumps({}),
                    "allowed_actions_json": dumps(["open_strategy"]),
                    "artifacts_json": dumps(session.get("artifacts", {})),
                    "created_at": session["created_at"],
                    "updated_at": iso_now(),
                },
            )
        return self.get_strategy(strategy_id)

    def get_strategy(self, strategy_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM strategies WHERE id = ?", (strategy_id,))
        if not row:
            raise KeyError(f"Strategy not found: {strategy_id}")
        strategy = self._decode_strategy(row)
        strategy["recent_runs"] = self.list_backtest_runs(strategy_id=strategy_id, limit=10)
        return strategy

    def list_strategies(self) -> list[dict[str, Any]]:
        return [self._decode_strategy(row) for row in self.storage.fetch_all("SELECT * FROM strategies ORDER BY updated_at DESC")]

    def get_backtest_run(self, run_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM backtest_runs WHERE id = ?", (run_id,))
        if not row:
            raise KeyError(f"Backtest run not found: {run_id}")
        return self._decode_run(row)

    def list_backtest_runs(
        self,
        strategy_id: str | None = None,
        *,
        status: str | None = None,
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        return [
            self._run_list_item(row)
            for row in self._backtest_run_list_rows(strategy_id, status=status, limit=limit)
        ]

    def workspace_summary(self) -> dict[str, Any]:
        strategies = self.list_strategies()
        recent_runs = self.list_backtest_runs(limit=20)
        return {
            "strategies": strategies,
            "recent_runs": recent_runs,
            "compare_candidates": [
                run
                for run in recent_runs
                if run.get("status") == "completed" and run.get("request_kind") == "official"
            ],
        }

    get_workspace = workspace_summary
    list_workspace = workspace_summary
    create_strategy_from_session = materialize_strategy
    prepare_confirmation_request = prepare_confirmation


PlatformService = BacktestPlatformService

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator, Mapping, MutableMapping, Sequence


def utc_now() -> datetime:
    return datetime.now(UTC)


def iso_now() -> str:
    return utc_now().isoformat(timespec="seconds").replace("+00:00", "Z")


def dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def loads(value: str | bytes | bytearray | None, default: Any = None) -> Any:
    if value is None:
        return default
    if isinstance(value, (bytes, bytearray)):
        value = value.decode("utf-8")
    if value == "":
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def is_snapshot_blocking(summary: Mapping[str, Any] | None) -> bool:
    if not summary:
        return True
    status = str(summary.get("status") or "").upper()
    if status in {"EMPTY", "FAILED", "INCOMPLETE", "MISSING", "STALE"}:
        return True
    if int(summary.get("symbol_count") or 0) <= 0:
        return True
    if int(summary.get("row_count") or 0) <= 0:
        return True
    return bool(summary.get("blocking"))


def _dict_row_factory(cursor: sqlite3.Cursor, row: tuple[Any, ...]) -> dict[str, Any]:
    return {description[0]: row[index] for index, description in enumerate(cursor.description)}


def _apply_pragmas(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 3000")

def _try_enable_wal_mode(conn: sqlite3.Connection) -> None:
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
    except sqlite3.OperationalError as exc:
        # Switching journal mode requires stronger locks than ordinary reads.
        # If another short-lived connection overlaps startup, keep the database
        # usable instead of stalling every request on WAL negotiation.
        if "database is locked" not in str(exc).lower():
            raise


SCHEMA_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS strategy_creation_sessions (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'DRAFTING',
        strategy_type TEXT NOT NULL DEFAULT 'GENERAL',
        universe_name TEXT NOT NULL DEFAULT '',
        rebalance_frequency TEXT,
        prompt TEXT NOT NULL DEFAULT '',
        revision INTEGER NOT NULL DEFAULT 1,
        strategy_id TEXT,
        suggested_name TEXT,
        confirmation_fields_json TEXT NOT NULL DEFAULT '{}',
        pending_inputs_json TEXT NOT NULL DEFAULT '[]',
        manual_conflicts_json TEXT NOT NULL DEFAULT '[]',
        allowed_actions_json TEXT NOT NULL DEFAULT '[]',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS strategy_creation_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        content TEXT NOT NULL,
        extracted_fields_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY(session_id) REFERENCES strategy_creation_sessions(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS strategies (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        strategy_type TEXT NOT NULL,
        universe_name TEXT NOT NULL DEFAULT '',
        rebalance_frequency TEXT,
        lifecycle_status TEXT NOT NULL DEFAULT 'ACTIVE',
        dataset_snapshot_id TEXT,
        universe_snapshot_id TEXT,
        benchmark_symbol TEXT NOT NULL DEFAULT 'SPY',
        current_parameter_version INTEGER NOT NULL DEFAULT 1,
        parameters_json TEXT NOT NULL DEFAULT '{}',
        confirmation_fields_json TEXT NOT NULL DEFAULT '{}',
        parameter_history_json TEXT NOT NULL DEFAULT '[]',
        allowed_actions_json TEXT NOT NULL DEFAULT '[]',
        latest_run_id TEXT,
        latest_successful_run_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS strategy_parameter_versions (
        parameter_version_id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        comment TEXT,
        parameters_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY(strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS backtest_runs (
        id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        status TEXT NOT NULL,
        source_run_id TEXT,
        request_kind TEXT NOT NULL DEFAULT 'official',
        is_permanent INTEGER NOT NULL DEFAULT 1,
        start_date TEXT,
        end_date TEXT,
        effective_date TEXT,
        oos_start_date TEXT,
        coverage_ratio REAL,
        coverage_days INTEGER,
        warnings_json TEXT NOT NULL DEFAULT '[]',
        request_json TEXT NOT NULL DEFAULT '{}',
        preview_json TEXT NOT NULL DEFAULT '{}',
        metrics_json TEXT NOT NULL DEFAULT '{}',
        parameter_snapshot_json TEXT NOT NULL DEFAULT '{}',
        environment_summary_json TEXT NOT NULL DEFAULT '{}',
        relative_metrics_json TEXT NOT NULL DEFAULT '{}',
        consistency_score_json TEXT NOT NULL DEFAULT '{}',
        risk_metrics_json TEXT NOT NULL DEFAULT '{}',
        drawdown_events_json TEXT NOT NULL DEFAULT '[]',
        rolling_metrics_json TEXT NOT NULL DEFAULT '[]',
        monthly_returns_json TEXT NOT NULL DEFAULT '[]',
        chart_series_json TEXT NOT NULL DEFAULT '[]',
        trades_json TEXT NOT NULL DEFAULT '[]',
        artifact_paths_json TEXT NOT NULL DEFAULT '[]',
        trade_audit_json TEXT NOT NULL DEFAULT '[]',
        trades_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY(strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS snapshot_refresh_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL DEFAULT '{}',
        summary_json TEXT NOT NULL DEFAULT '{}',
        warnings_json TEXT NOT NULL DEFAULT '[]',
        errors_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS app_runtime_state (
        state_key TEXT PRIMARY KEY,
        state_json TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS optimization_jobs (
        id TEXT PRIMARY KEY,
        strategy_id TEXT NOT NULL,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL DEFAULT '{}',
        summary_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        candidates_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY(strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS symbol_identity_cache (
        symbol TEXT PRIMARY KEY,
        canonical_symbol TEXT NOT NULL DEFAULT '',
        company_name TEXT NOT NULL DEFAULT '',
        cik TEXT NOT NULL DEFAULT '',
        exchange TEXT NOT NULL DEFAULT '',
        ipo_date TEXT,
        delisting_date TEXT,
        source TEXT NOT NULL DEFAULT '',
        valid_from TEXT,
        valid_to TEXT
    )
    """,
]


MIGRATION_COLUMNS = {
    "strategy_creation_messages": [
        ("extracted_fields_json", "TEXT NOT NULL DEFAULT '[]'"),
    ],
    "backtest_runs": [
        ("is_permanent", "INTEGER NOT NULL DEFAULT 1"),
        ("artifact_paths_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("trade_audit_json", "TEXT NOT NULL DEFAULT '[]'"),
    ]
}


def _table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    columns: set[str] = set()
    for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall():
        if isinstance(row, Mapping):
            column_name = row.get("name")
        else:
            column_name = row[1]
        if column_name is not None:
            columns.add(str(column_name))
    return columns


def _ensure_table_columns(conn: sqlite3.Connection, table_name: str, columns: list[tuple[str, str]]) -> None:
    existing = _table_columns(conn, table_name)
    if not existing:
        return
    for column_name, column_ddl in columns:
        if column_name not in existing:
            conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_ddl}")


def initialize_storage_schema(conn: sqlite3.Connection) -> None:
    _apply_pragmas(conn)
    for statement in SCHEMA_STATEMENTS:
        conn.execute(statement)
    for table_name, columns in MIGRATION_COLUMNS.items():
        _ensure_table_columns(conn, table_name, columns)
    conn.commit()


class SQLiteStorage:
    def __init__(self, database_path: str | Path):
        self.path = Path(database_path)
        if self.path.parent and self.path.parent != Path("."):
            self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as conn:
            _try_enable_wal_mode(conn)
            initialize_storage_schema(conn)

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = _dict_row_factory
        _apply_pragmas(conn)
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    connect = connection

    def fetch_all(self, sql: str, params: Sequence[Any] | Mapping[str, Any] | None = None) -> list[dict[str, Any]]:
        with self.connection() as conn:
            cursor = conn.execute(sql, params or ())
            return [dict(row) for row in cursor.fetchall()]

    def fetch_one(self, sql: str, params: Sequence[Any] | Mapping[str, Any] | None = None) -> dict[str, Any] | None:
        with self.connection() as conn:
            cursor = conn.execute(sql, params or ())
            row = cursor.fetchone()
            return dict(row) if row else None

    def execute(self, sql: str, params: Sequence[Any] | Mapping[str, Any] | None = None) -> None:
        with self.connection() as conn:
            conn.execute(sql, params or ())

    def executemany(self, sql: str, rows: Sequence[Sequence[Any]]) -> None:
        with self.connection() as conn:
            conn.executemany(sql, rows)

    def insert_json_row(self, table: str, payload: Mapping[str, Any]) -> None:
        columns = list(payload)
        values = [payload[column] for column in columns]
        names = ", ".join(columns)
        placeholders = ", ".join("?" for _ in columns)
        if "id" in payload:
            assignments = ", ".join(f"{column}=excluded.{column}" for column in columns if column != "id")
            sql = f"INSERT INTO {table} ({names}) VALUES ({placeholders})"
            if assignments:
                sql += f" ON CONFLICT(id) DO UPDATE SET {assignments}"
            else:
                sql += " ON CONFLICT(id) DO NOTHING"
            self.execute(sql, values)
            return
        self.execute(f"INSERT OR REPLACE INTO {table} ({names}) VALUES ({placeholders})", values)


def initialize_storage(database_path: str | Path) -> SQLiteStorage:
    return SQLiteStorage(database_path)


def normalize_json_columns(record: MutableMapping[str, Any], *column_names: str) -> MutableMapping[str, Any]:
    for column_name in column_names:
        record[column_name] = loads(record.get(column_name))
    return record

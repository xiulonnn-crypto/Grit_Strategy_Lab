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
        change_summary TEXT,
        decision_note TEXT,
        source_json TEXT NOT NULL DEFAULT '{}',
        alternative_versions_json TEXT NOT NULL DEFAULT '[]',
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
        is_permanent INTEGER NOT NULL DEFAULT 0,
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
        trade_audit_items_json TEXT NOT NULL DEFAULT '[]',
        trade_audit_json TEXT NOT NULL DEFAULT '[]',
        trades_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        deleted_at TEXT,
        deleted_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY(strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS backtest_run_checkpoints (
        run_id TEXT PRIMARY KEY,
        stage TEXT NOT NULL DEFAULT 'PREPARING',
        state_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS backtest_run_checkpoint_chunks (
        run_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        daily_performance_json TEXT NOT NULL DEFAULT '[]',
        trades_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES backtest_runs(id) ON DELETE CASCADE,
        PRIMARY KEY(run_id, chunk_index)
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
    CREATE TABLE IF NOT EXISTS factor_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        market TEXT NOT NULL DEFAULT 'US',
        universe TEXT NOT NULL DEFAULT 'SP500',
        source TEXT NOT NULL DEFAULT 'MANUAL',
        lifecycle_status TEXT NOT NULL DEFAULT 'DRAFT',
        diagnostic_status TEXT NOT NULL DEFAULT 'BLOCKED_PIT',
        direction TEXT NOT NULL DEFAULT 'HIGH_IS_BETTER',
        frequency TEXT NOT NULL DEFAULT 'DAILY',
        expression TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        data_requirements_json TEXT NOT NULL DEFAULT '[]',
        institutional_note TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        offline_reason TEXT,
        offline_at TEXT,
        offline_command TEXT,
        offline_detail_json TEXT NOT NULL DEFAULT '{}',
        deleted_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS factor_versions (
        id TEXT PRIMARY KEY,
        factor_id TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        expression TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (factor_id) REFERENCES factor_definitions(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS factor_diagnostic_runs (
        id TEXT PRIMARY KEY,
        factor_id TEXT NOT NULL,
        status TEXT NOT NULL,
        dataset_snapshot_id TEXT NOT NULL,
        universe_snapshot_id TEXT NOT NULL,
        request_json TEXT NOT NULL DEFAULT '{}',
        summary_json TEXT NOT NULL DEFAULT '{}',
        artifact_refs_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        completed_at TEXT,
        error_message TEXT,
        FOREIGN KEY (factor_id) REFERENCES factor_definitions(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS factor_mining_jobs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL DEFAULT '{}',
        progress_json TEXT NOT NULL DEFAULT '{}',
        summary_json TEXT NOT NULL DEFAULT '{}',
        top_candidates_json TEXT NOT NULL DEFAULT '[]',
        failed_samples_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        error_message TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS factor_mining_candidates (
        id TEXT PRIMARY KEY,
        job_id TEXT NOT NULL,
        expression TEXT NOT NULL,
        score REAL,
        rank_ic REAL,
        turnover REAL,
        coverage REAL,
        depth INTEGER,
        risk_flags_json TEXT NOT NULL DEFAULT '[]',
        summary_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES factor_mining_jobs(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS factor_factory_profiles (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'PAUSED',
        timezone TEXT NOT NULL DEFAULT 'Asia/Hong_Kong',
        schedule_time TEXT NOT NULL DEFAULT '14:00',
        request_json TEXT NOT NULL DEFAULT '{}',
        gate_policy_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_run_date TEXT,
        next_run_at TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS factor_factory_runs (
        id TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL DEFAULT 'default',
        run_date TEXT NOT NULL,
        trigger TEXT NOT NULL DEFAULT 'DAILY',
        status TEXT NOT NULL DEFAULT 'QUEUED',
        request_json TEXT NOT NULL DEFAULT '{}',
        gate_policy_json TEXT NOT NULL DEFAULT '{}',
        config_signature TEXT NOT NULL,
        mining_job_id TEXT,
        summary_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        error_message TEXT,
        FOREIGN KEY (mining_job_id) REFERENCES factor_mining_jobs(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS factor_factory_run_items (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        stage TEXT NOT NULL,
        source_id TEXT,
        target_id TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        summary_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES factor_factory_runs(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS factor_quarantine_candidates (
        id TEXT PRIMARY KEY,
        mining_candidate_id TEXT,
        source_mining_job_id TEXT,
        expression TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        publish_status TEXT NOT NULL DEFAULT 'BLOCKED',
        gate_summary_json TEXT NOT NULL DEFAULT '{}',
        cluster_id TEXT,
        candidate_metrics_json TEXT NOT NULL DEFAULT '{}',
        failure_samples_json TEXT NOT NULL DEFAULT '[]',
        pit_evidence_json TEXT NOT NULL DEFAULT '{}',
        publish_eligibility_json TEXT NOT NULL DEFAULT '{}',
        target_factor_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        published_at TEXT,
        rejected_reason TEXT,
        UNIQUE(mining_candidate_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS factor_quarantine_runs (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL DEFAULT '{}',
        is_oos_json TEXT NOT NULL DEFAULT '{}',
        orthogonal_json TEXT NOT NULL DEFAULT '{}',
        stability_json TEXT NOT NULL DEFAULT '{}',
        risk_tags_json TEXT NOT NULL DEFAULT '[]',
        summary_json TEXT NOT NULL DEFAULT '{}',
        artifact_refs_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        completed_at TEXT,
        error_message TEXT,
        FOREIGN KEY (candidate_id) REFERENCES factor_quarantine_candidates(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS factor_publish_events (
        id TEXT PRIMARY KEY,
        candidate_id TEXT NOT NULL,
        factor_id TEXT NOT NULL,
        event_type TEXT NOT NULL DEFAULT 'AUTO_PUBLISH',
        rule_version TEXT NOT NULL,
        before_json TEXT NOT NULL DEFAULT '{}',
        after_json TEXT NOT NULL DEFAULT '{}',
        created_by TEXT NOT NULL DEFAULT 'system_rule',
        created_at TEXT NOT NULL,
        FOREIGN KEY (candidate_id) REFERENCES factor_quarantine_candidates(id),
        FOREIGN KEY (factor_id) REFERENCES factor_definitions(id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS factor_lineage_edges (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS factor_crowding_snapshots (
        id TEXT PRIMARY KEY,
        factor_id TEXT NOT NULL,
        snapshot_date TEXT NOT NULL,
        usage_count INTEGER NOT NULL DEFAULT 0,
        avg_weight REAL NOT NULL DEFAULT 0,
        max_weight REAL NOT NULL DEFAULT 0,
        cluster_published_count INTEGER NOT NULL DEFAULT 0,
        ic_drift REAL,
        governance_status TEXT NOT NULL DEFAULT 'WATCH',
        summary_json TEXT NOT NULL DEFAULT '{}',
        artifact_refs_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (factor_id) REFERENCES factor_definitions(id)
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
        deleted_at TEXT,
        deleted_reason TEXT,
        FOREIGN KEY(strategy_id) REFERENCES strategies(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS optimization_job_trials (
        job_id TEXT NOT NULL,
        trial_index INTEGER NOT NULL,
        status TEXT NOT NULL,
        parameter_snapshot_json TEXT NOT NULL DEFAULT '{}',
        metrics_json TEXT NOT NULL DEFAULT '{}',
        chart_series_json TEXT NOT NULL DEFAULT '[]',
        score REAL,
        return_sharpe REAL,
        oos_sharpe REAL,
        total_return_pct REAL,
        stability REAL,
        error_message TEXT,
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY(job_id) REFERENCES optimization_jobs(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS idx_optimization_job_trials_job_id_trial_index
    ON optimization_job_trials(job_id, trial_index)
    """,
    """
    CREATE TABLE IF NOT EXISTS asset_leg_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        symbol TEXT NOT NULL,
        asset_kind TEXT NOT NULL,
        source_snapshot_id TEXT NOT NULL,
        source_provider TEXT,
        freeze_mode TEXT NOT NULL,
        summary_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        revision INTEGER NOT NULL DEFAULT 1,
        current_freeze_generation INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_reason TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS cash_leg_definitions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cash_rule_kind TEXT NOT NULL,
        buffer_bps REAL NOT NULL DEFAULT 0,
        yield_source TEXT,
        freeze_mode TEXT NOT NULL,
        summary_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        revision INTEGER NOT NULL DEFAULT 1,
        current_freeze_generation INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_reason TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS compositions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        benchmark_definition_json TEXT NOT NULL DEFAULT '{}',
        rebalance_frequency TEXT,
        cost_policy_json TEXT NOT NULL DEFAULT '{}',
        summary_json TEXT NOT NULL DEFAULT '{}',
        analysis_json TEXT NOT NULL DEFAULT '{}',
        revision INTEGER NOT NULL DEFAULT 1,
        current_freeze_generation INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_reason TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS composition_legs (
        id TEXT PRIMARY KEY,
        composition_id TEXT NOT NULL,
        leg_kind TEXT NOT NULL,
        source_ref_id TEXT NOT NULL,
        source_ref_type TEXT NOT NULL,
        display_name TEXT NOT NULL DEFAULT '',
        weight_pct REAL NOT NULL DEFAULT 0,
        weight_locked INTEGER NOT NULL DEFAULT 0,
        ordering INTEGER NOT NULL DEFAULT 1,
        config_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        revision INTEGER NOT NULL DEFAULT 1,
        current_freeze_generation INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_reason TEXT,
        FOREIGN KEY(composition_id) REFERENCES compositions(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS composition_source_freezes (
        id TEXT PRIMARY KEY,
        composition_id TEXT NOT NULL,
        leg_id TEXT NOT NULL,
        freeze_ref_type TEXT NOT NULL,
        freeze_ref_id TEXT NOT NULL,
        freeze_hash TEXT NOT NULL,
        freeze_generation INTEGER NOT NULL DEFAULT 1,
        is_current INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        revision INTEGER NOT NULL DEFAULT 1,
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT,
        deleted_at TEXT,
        deleted_reason TEXT,
        FOREIGN KEY(composition_id) REFERENCES compositions(id) ON DELETE CASCADE,
        FOREIGN KEY(leg_id) REFERENCES composition_legs(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS composition_audit_events (
        id TEXT PRIMARY KEY,
        composition_id TEXT NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1,
        action TEXT NOT NULL,
        actor TEXT NOT NULL DEFAULT 'system',
        summary_json TEXT NOT NULL DEFAULT '{}',
        hash_before TEXT,
        hash_after TEXT,
        source_ref_id TEXT,
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(composition_id) REFERENCES compositions(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS composition_proxy_confirmations (
        id TEXT PRIMARY KEY,
        composition_id TEXT NOT NULL,
        leg_id TEXT,
        target_symbol TEXT,
        proxy_symbol TEXT,
        horizon_label TEXT,
        proxy_signature TEXT NOT NULL,
        confirmation_scope_json TEXT NOT NULL DEFAULT '{}',
        reason TEXT,
        confirmed_by TEXT NOT NULL DEFAULT 'operator',
        confirmed_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_reason TEXT,
        FOREIGN KEY(composition_id) REFERENCES compositions(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS composition_backtest_runs (
        id TEXT PRIMARY KEY,
        composition_id TEXT NOT NULL,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        orders_json TEXT NOT NULL DEFAULT '[]',
        evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        deleted_at TEXT,
        deleted_reason TEXT,
        FOREIGN KEY(composition_id) REFERENCES compositions(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS composition_allocation_jobs (
        id TEXT PRIMARY KEY,
        composition_id TEXT NOT NULL,
        status TEXT NOT NULL,
        request_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        deleted_at TEXT,
        deleted_reason TEXT,
        FOREIGN KEY(composition_id) REFERENCES compositions(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS composition_versions (
        id TEXT PRIMARY KEY,
        composition_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        source_kind TEXT NOT NULL DEFAULT 'manual',
        source_ref_id TEXT,
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        diff_json TEXT NOT NULL DEFAULT '{}',
        evidence_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_reason TEXT,
        FOREIGN KEY(composition_id) REFERENCES compositions(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS composition_decision_packets (
        id TEXT PRIMARY KEY,
        composition_id TEXT NOT NULL,
        version_id TEXT,
        source_refs_json TEXT NOT NULL DEFAULT '{}',
        packet_json TEXT NOT NULL DEFAULT '{}',
        export_markdown TEXT NOT NULL DEFAULT '',
        export_html TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        deleted_at TEXT,
        deleted_reason TEXT,
        FOREIGN KEY(composition_id) REFERENCES compositions(id) ON DELETE CASCADE,
        FOREIGN KEY(version_id) REFERENCES composition_versions(id) ON DELETE SET NULL
    )
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_legs_composition_id_ordering
    ON composition_legs(composition_id, ordering)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_legs_source_ref
    ON composition_legs(source_ref_id, leg_kind)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_source_freezes_composition_leg
    ON composition_source_freezes(composition_id, leg_id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_audit_events_composition
    ON composition_audit_events(composition_id, occurred_at, id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_proxy_confirmations_composition_signature
    ON composition_proxy_confirmations(composition_id, proxy_signature, status, deleted_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_backtest_runs_composition
    ON composition_backtest_runs(composition_id, created_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_allocation_jobs_composition
    ON composition_allocation_jobs(composition_id, created_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_versions_composition
    ON composition_versions(composition_id, version_number, created_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_decision_packets_composition
    ON composition_decision_packets(composition_id, created_at)
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
    "strategy_parameter_versions": [
        ("change_summary", "TEXT"),
        ("decision_note", "TEXT"),
        ("source_json", "TEXT NOT NULL DEFAULT '{}'"),
        ("alternative_versions_json", "TEXT NOT NULL DEFAULT '[]'"),
    ],
    "backtest_runs": [
        ("is_permanent", "INTEGER NOT NULL DEFAULT 0"),
        ("artifact_paths_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("trade_audit_items_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("trade_audit_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("deleted_at", "TEXT"),
        ("deleted_reason", "TEXT"),
    ],
    "optimization_jobs": [
        ("deleted_at", "TEXT"),
        ("deleted_reason", "TEXT"),
    ],
    "optimization_job_trials": [
        ("return_sharpe", "REAL"),
        ("oos_sharpe", "REAL"),
        ("total_return_pct", "REAL"),
        ("stability", "REAL"),
    ],
    "asset_leg_definitions": [
        ("revision", "INTEGER NOT NULL DEFAULT 1"),
        ("current_freeze_generation", "INTEGER NOT NULL DEFAULT 1"),
        ("deleted_at", "TEXT"),
        ("deleted_reason", "TEXT"),
    ],
    "cash_leg_definitions": [
        ("revision", "INTEGER NOT NULL DEFAULT 1"),
        ("current_freeze_generation", "INTEGER NOT NULL DEFAULT 1"),
        ("deleted_at", "TEXT"),
        ("deleted_reason", "TEXT"),
    ],
    "compositions": [
        ("revision", "INTEGER NOT NULL DEFAULT 1"),
        ("current_freeze_generation", "INTEGER NOT NULL DEFAULT 1"),
        ("deleted_at", "TEXT"),
        ("deleted_reason", "TEXT"),
    ],
    "composition_legs": [
        ("status", "TEXT NOT NULL DEFAULT 'ACTIVE'"),
        ("revision", "INTEGER NOT NULL DEFAULT 1"),
        ("current_freeze_generation", "INTEGER NOT NULL DEFAULT 1"),
        ("deleted_at", "TEXT"),
        ("deleted_reason", "TEXT"),
    ],
    "composition_source_freezes": [
        ("freeze_generation", "INTEGER NOT NULL DEFAULT 1"),
        ("is_current", "INTEGER NOT NULL DEFAULT 1"),
        ("status", "TEXT NOT NULL DEFAULT 'ACTIVE'"),
        ("revision", "INTEGER NOT NULL DEFAULT 1"),
        ("updated_at", "TEXT"),
        ("deleted_at", "TEXT"),
        ("deleted_reason", "TEXT"),
    ],
    "factor_definitions": [
        ("offline_reason", "TEXT"),
        ("offline_at", "TEXT"),
        ("offline_command", "TEXT"),
        ("offline_detail_json", "TEXT NOT NULL DEFAULT '{}'"),
    ],
}


PRE_MIGRATION_INDEX_STATEMENTS = [
    "DROP INDEX IF EXISTS idx_asset_leg_definitions_active_unique",
    "DROP INDEX IF EXISTS idx_cash_leg_definitions_active_unique",
]


POST_MIGRATION_INDEX_STATEMENTS = [
    """
    CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy_recent
    ON backtest_runs(strategy_id, deleted_at, completed_at, created_at, id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_backtest_runs_recent
    ON backtest_runs(deleted_at, completed_at, created_at, id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_backtest_runs_status_recent
    ON backtest_runs(status, deleted_at, completed_at, created_at, id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_backtest_run_checkpoints_updated
    ON backtest_run_checkpoints(updated_at, run_id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_backtest_run_checkpoint_chunks_run_chunk
    ON backtest_run_checkpoint_chunks(run_id, chunk_index)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_optimization_jobs_strategy_recent
    ON optimization_jobs(strategy_id, deleted_at, created_at, id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_optimization_jobs_recent
    ON optimization_jobs(deleted_at, updated_at, created_at, id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_factor_mining_jobs_recent
    ON factor_mining_jobs(updated_at, created_at, id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_factor_mining_candidates_job_score
    ON factor_mining_candidates(job_id, score DESC)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_factor_factory_profiles_status
    ON factor_factory_profiles(status, updated_at)
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS idx_factor_factory_runs_daily_signature
    ON factor_factory_runs(profile_id, run_date, config_signature)
    WHERE trigger = 'DAILY'
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_factor_factory_runs_recent
    ON factor_factory_runs(updated_at, created_at, id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_factor_factory_run_items_run_stage
    ON factor_factory_run_items(run_id, stage, status, updated_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_factor_quarantine_candidates_status
    ON factor_quarantine_candidates(status, publish_status, updated_at, id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_factor_quarantine_candidates_job
    ON factor_quarantine_candidates(source_mining_job_id, status, updated_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_factor_quarantine_runs_candidate
    ON factor_quarantine_runs(candidate_id, created_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_factor_publish_events_candidate
    ON factor_publish_events(candidate_id, created_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_factor_lineage_edges_target
    ON factor_lineage_edges(target_type, target_id, created_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_factor_crowding_snapshots_factor
    ON factor_crowding_snapshots(factor_id, snapshot_date)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_backtest_runs_recent
    ON composition_backtest_runs(deleted_at, created_at, id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_allocation_jobs_recent
    ON composition_allocation_jobs(deleted_at, created_at, id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_versions_status
    ON composition_versions(composition_id, status, deleted_at, created_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_asset_leg_definitions_active_updated
    ON asset_leg_definitions(status, deleted_at, updated_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_asset_leg_definitions_source_snapshot
    ON asset_leg_definitions(source_snapshot_id, source_provider, status)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_asset_leg_definitions_active_semantic_lookup
    ON asset_leg_definitions(symbol, asset_kind, source_snapshot_id, freeze_mode, status)
    WHERE deleted_at IS NULL
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_asset_leg_definitions_freeze_generation
    ON asset_leg_definitions(current_freeze_generation, revision)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_cash_leg_definitions_active_updated
    ON cash_leg_definitions(status, deleted_at, updated_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_cash_leg_definitions_yield_source
    ON cash_leg_definitions(yield_source, status)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_cash_leg_definitions_active_semantic_lookup
    ON cash_leg_definitions(cash_rule_kind, COALESCE(yield_source, ''), freeze_mode, status)
    WHERE deleted_at IS NULL
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_cash_leg_definitions_freeze_generation
    ON cash_leg_definitions(current_freeze_generation, revision)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_compositions_active_updated
    ON compositions(status, deleted_at, updated_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_compositions_freeze_generation
    ON compositions(current_freeze_generation, revision)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_legs_active_ordering
    ON composition_legs(composition_id, status, deleted_at, ordering)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_legs_freeze_generation
    ON composition_legs(composition_id, current_freeze_generation, revision)
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS idx_composition_legs_current_source_unique
    ON composition_legs(composition_id, leg_kind, source_ref_id, current_freeze_generation)
    WHERE deleted_at IS NULL
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_source_freezes_generation
    ON composition_source_freezes(composition_id, freeze_generation, is_current, status)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_source_freezes_ref_generation
    ON composition_source_freezes(freeze_ref_type, freeze_ref_id, freeze_generation)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_source_freezes_active
    ON composition_source_freezes(status, deleted_at, created_at)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_composition_audit_events_action
    ON composition_audit_events(action, occurred_at)
    """,
]


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
    for statement in PRE_MIGRATION_INDEX_STATEMENTS:
        conn.execute(statement)
    for statement in POST_MIGRATION_INDEX_STATEMENTS:
        conn.execute(statement)
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

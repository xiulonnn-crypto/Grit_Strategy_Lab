from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping

from .storage import dumps, iso_now, loads


DATASET_PRICE_SNAPSHOT_ID = "ds-price"
DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID = "ds-corporate-actions"
DATASET_INDEX_VALUATIONS_SNAPSHOT_ID = "ds-index-valuations"
DATASET_FUNDAMENTALS_SNAPSHOT_ID = "ds-fundamentals"
DEFAULT_UNIVERSE_ANCHOR_SCHEDULE = "01-01,07-01"


@dataclass(slots=True)
class CoverageSummary:
    symbol: str
    start_date: str | None
    end_date: str | None
    trade_days: int


@dataclass(slots=True)
class IndexValuationCoverageSummary:
    index_key: str
    start_date: str | None
    end_date: str | None
    observation_count: int
    latest_date: str | None = None
    latest_pe_ttm: float | None = None
    latest_percentile_10y: float | None = None


def _row_factory(cursor: sqlite3.Cursor, row: tuple[Any, ...]) -> dict[str, Any]:
    return {description[0]: row[index] for index, description in enumerate(cursor.description)}


def _normalize_symbol(value: str) -> str:
    return value.strip().upper()


def _normalize_index_key(value: str) -> str:
    return value.strip().lower()


def _ensure_json_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    return {}


def _table_columns(conn: sqlite3.Connection, table_name: str) -> set[str]:
    return {str(row["name"]) for row in conn.execute(f"PRAGMA table_info({table_name})").fetchall()}


def _ensure_table_columns(conn: sqlite3.Connection, table_name: str, columns: list[tuple[str, str]]) -> None:
    existing = _table_columns(conn, table_name)
    if not existing:
        return
    for column_name, column_ddl in columns:
        if column_name not in existing:
            conn.execute(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_ddl}")


def _fundamental_points_primary_key(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute("PRAGMA table_info(dataset_fundamental_points)").fetchall()
    keyed = [
        (int(row["pk"] or 0), str(row["name"]))
        for row in rows
        if int(row["pk"] or 0) > 0
    ]
    return [name for _order, name in sorted(keyed)]


def _rebuild_fundamental_points_available_at_pk(conn: sqlite3.Connection) -> None:
    if _fundamental_points_primary_key(conn) == ["dataset_snapshot_id", "symbol", "date", "available_at"]:
        return
    conn.execute("ALTER TABLE dataset_fundamental_points RENAME TO dataset_fundamental_points_legacy_pk")
    conn.execute(
        """
        CREATE TABLE dataset_fundamental_points (
            dataset_snapshot_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            period_end_date TEXT,
            available_at TEXT NOT NULL,
            ltm_earnings REAL,
            market_cap REAL,
            book_value_equity REAL,
            operating_cash_flow REAL,
            capex REAL,
            enterprise_value REAL,
            total_shares REAL,
            shares_outstanding REAL,
            total_debt REAL,
            cash_and_equivalents REAL,
            provider_market_cap REAL,
            provider_enterprise_value REAL,
            market_cap_source TEXT,
            enterprise_value_source TEXT,
            source TEXT NOT NULL DEFAULT '',
            fallback_source TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY(dataset_snapshot_id, symbol, date, available_at),
            FOREIGN KEY(dataset_snapshot_id) REFERENCES dataset_snapshots(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        INSERT OR REPLACE INTO dataset_fundamental_points (
            dataset_snapshot_id, symbol, date, period_end_date, available_at,
            ltm_earnings, market_cap, book_value_equity,
            operating_cash_flow, capex, enterprise_value, total_shares,
            shares_outstanding, total_debt, cash_and_equivalents,
            provider_market_cap, provider_enterprise_value,
            market_cap_source, enterprise_value_source,
            source, fallback_source, metadata_json
        )
        SELECT
            dataset_snapshot_id, symbol, date, COALESCE(period_end_date, date),
            COALESCE(available_at, date),
            ltm_earnings, market_cap, book_value_equity,
            operating_cash_flow, capex, enterprise_value, total_shares,
            COALESCE(shares_outstanding, total_shares), total_debt, cash_and_equivalents,
            provider_market_cap, provider_enterprise_value,
            market_cap_source, enterprise_value_source,
            source, fallback_source, metadata_json
        FROM dataset_fundamental_points_legacy_pk
        """
    )
    conn.execute("DROP TABLE dataset_fundamental_points_legacy_pk")


def initialize_market_data_schema(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS market_bars (
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            adj_close REAL,
            volume REAL,
            PRIMARY KEY(symbol, date)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS market_actions (
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            action_type TEXT NOT NULL,
            value REAL,
            payload_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY(symbol, date, action_type)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS market_coverages (
            symbol TEXT PRIMARY KEY,
            start_date TEXT,
            end_date TEXT,
            trade_days INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS dataset_snapshots (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            as_of TEXT,
            freshness_label TEXT,
            start_date TEXT,
            end_date TEXT,
            row_count INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT '',
            fallback_source TEXT,
            blocker_json TEXT NOT NULL DEFAULT '{}',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS universe_snapshots (
            id TEXT PRIMARY KEY,
            universe_key TEXT NOT NULL,
            name TEXT NOT NULL,
            status TEXT NOT NULL,
            as_of TEXT,
            freshness_label TEXT,
            window_start TEXT,
            window_end TEXT,
            anchor_schedule TEXT NOT NULL DEFAULT '01-01,07-01',
            member_count INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT '',
            fallback_source TEXT,
            blocker_json TEXT NOT NULL DEFAULT '{}',
            metadata_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS dataset_price_bars (
            dataset_snapshot_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            adj_close REAL,
            volume REAL,
            source TEXT NOT NULL DEFAULT '',
            fallback_source TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY(dataset_snapshot_id, symbol, date),
            FOREIGN KEY(dataset_snapshot_id) REFERENCES dataset_snapshots(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS dataset_corporate_actions (
            dataset_snapshot_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            event_date TEXT NOT NULL,
            event_type TEXT NOT NULL,
            value REAL,
            source TEXT NOT NULL DEFAULT '',
            fallback_source TEXT,
            payload_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY(dataset_snapshot_id, symbol, event_date, event_type),
            FOREIGN KEY(dataset_snapshot_id) REFERENCES dataset_snapshots(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS dataset_symbol_coverage (
            dataset_snapshot_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            start_date TEXT,
            end_date TEXT,
            trade_days INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL DEFAULT '',
            fallback_source TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY(dataset_snapshot_id, symbol),
            FOREIGN KEY(dataset_snapshot_id) REFERENCES dataset_snapshots(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS dataset_index_valuations (
            dataset_snapshot_id TEXT NOT NULL,
            index_key TEXT NOT NULL,
            date TEXT NOT NULL,
            proxy_symbol TEXT NOT NULL DEFAULT '',
            pe_ttm REAL,
            pe_ttm_percentile_10y REAL,
            source TEXT NOT NULL DEFAULT '',
            fallback_source TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY(dataset_snapshot_id, index_key, date),
            FOREIGN KEY(dataset_snapshot_id) REFERENCES dataset_snapshots(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS dataset_index_valuation_coverage (
            dataset_snapshot_id TEXT NOT NULL,
            index_key TEXT NOT NULL,
            start_date TEXT,
            end_date TEXT,
            observation_count INTEGER NOT NULL DEFAULT 0,
            latest_date TEXT,
            latest_pe_ttm REAL,
            latest_percentile_10y REAL,
            source TEXT NOT NULL DEFAULT '',
            fallback_source TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY(dataset_snapshot_id, index_key),
            FOREIGN KEY(dataset_snapshot_id) REFERENCES dataset_snapshots(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS dataset_fundamental_points (
            dataset_snapshot_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            date TEXT NOT NULL,
            period_end_date TEXT,
            available_at TEXT,
            ltm_earnings REAL,
            market_cap REAL,
            book_value_equity REAL,
            operating_cash_flow REAL,
            capex REAL,
            enterprise_value REAL,
            total_shares REAL,
            shares_outstanding REAL,
            total_debt REAL,
            cash_and_equivalents REAL,
            provider_market_cap REAL,
            provider_enterprise_value REAL,
            market_cap_source TEXT,
            enterprise_value_source TEXT,
            source TEXT NOT NULL DEFAULT '',
            fallback_source TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY(dataset_snapshot_id, symbol, date, available_at),
            FOREIGN KEY(dataset_snapshot_id) REFERENCES dataset_snapshots(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS dataset_fundamental_coverage (
            dataset_snapshot_id TEXT NOT NULL,
            symbol TEXT NOT NULL,
            start_date TEXT,
            end_date TEXT,
            observation_count INTEGER NOT NULL DEFAULT 0,
            fields_json TEXT NOT NULL DEFAULT '[]',
            source TEXT NOT NULL DEFAULT '',
            fallback_source TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY(dataset_snapshot_id, symbol),
            FOREIGN KEY(dataset_snapshot_id) REFERENCES dataset_snapshots(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS bond_fixed_income_snapshots (
            id TEXT PRIMARY KEY,
            instrument_id TEXT NOT NULL,
            symbol TEXT NOT NULL DEFAULT '',
            isin TEXT,
            cusip TEXT,
            name TEXT NOT NULL DEFAULT '',
            instrument_type TEXT NOT NULL DEFAULT 'bond',
            currency TEXT NOT NULL DEFAULT 'USD',
            snapshot_date TEXT NOT NULL,
            maturity_date TEXT,
            coupon_rate_pct REAL,
            clean_price REAL,
            net_price REAL,
            dirty_price REAL,
            full_price REAL,
            accrued_interest REAL,
            ytm_pct REAL,
            duration REAL,
            convexity REAL,
            source TEXT NOT NULL DEFAULT '',
            source_snapshot_id TEXT,
            refresh_status TEXT NOT NULL DEFAULT 'STALE',
            missing_fields_json TEXT NOT NULL DEFAULT '[]',
            inferred_fields_json TEXT NOT NULL DEFAULT '{}',
            raw_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            refreshed_at TEXT,
            deleted_at TEXT,
            deleted_reason TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS universe_membership_snapshots (
            universe_snapshot_id TEXT NOT NULL,
            effective_date TEXT NOT NULL,
            symbol TEXT NOT NULL,
            raw_symbol TEXT,
            membership_status TEXT NOT NULL DEFAULT 'ACTIVE',
            source TEXT NOT NULL DEFAULT '',
            fallback_source TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}',
            PRIMARY KEY(universe_snapshot_id, effective_date, symbol),
            FOREIGN KEY(universe_snapshot_id) REFERENCES universe_snapshots(id) ON DELETE CASCADE
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pit_cleaning_runs (
            id TEXT PRIMARY KEY,
            dataset_snapshot_id TEXT NOT NULL,
            universe_snapshot_id TEXT NOT NULL,
            as_of_date TEXT NOT NULL,
            cleaning_version TEXT NOT NULL,
            status TEXT NOT NULL,
            adjusted_status TEXT NOT NULL DEFAULT 'UNKNOWN',
            universe_status TEXT NOT NULL DEFAULT 'UNKNOWN',
            outlier_status TEXT NOT NULL DEFAULT 'UNKNOWN',
            coverage_pct REAL NOT NULL DEFAULT 0,
            blocker_json TEXT NOT NULL DEFAULT '{}',
            summary_json TEXT NOT NULL DEFAULT '{}',
            created_at TEXT NOT NULL,
            completed_at TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pit_quality_events (
            id TEXT PRIMARY KEY,
            pit_cleaning_run_id TEXT,
            dataset_snapshot_id TEXT,
            universe_snapshot_id TEXT,
            event_time TEXT NOT NULL,
            severity TEXT NOT NULL,
            event_type TEXT NOT NULL,
            title TEXT NOT NULL,
            message TEXT NOT NULL,
            target_date TEXT,
            target_symbol TEXT,
            metadata_json TEXT NOT NULL DEFAULT '{}'
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pit_research_waivers (
            id TEXT PRIMARY KEY,
            dataset_snapshot_id TEXT NOT NULL,
            universe_snapshot_id TEXT NOT NULL,
            ignored_symbols_json TEXT NOT NULL DEFAULT '[]',
            reason TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL DEFAULT 'researcher',
            created_at TEXT NOT NULL,
            revoked_at TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS run_artifacts (
            run_id TEXT PRIMARY KEY,
            daily_performance_json TEXT NOT NULL DEFAULT '[]',
            trades_json TEXT NOT NULL DEFAULT '[]'
        )
        """
    )
    conn.execute(
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
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_dataset_price_bars_symbol_date ON dataset_price_bars(symbol, date)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_dataset_actions_symbol_date ON dataset_corporate_actions(symbol, event_date)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_dataset_index_valuations_key_date ON dataset_index_valuations(index_key, date)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_dataset_fundamental_points_symbol_date ON dataset_fundamental_points(symbol, date)"
    )
    _ensure_table_columns(
        conn,
        "dataset_fundamental_points",
        [
            ("period_end_date", "TEXT"),
            ("available_at", "TEXT"),
            ("book_value_equity", "REAL"),
            ("shares_outstanding", "REAL"),
            ("total_debt", "REAL"),
            ("cash_and_equivalents", "REAL"),
            ("provider_market_cap", "REAL"),
            ("provider_enterprise_value", "REAL"),
            ("market_cap_source", "TEXT"),
            ("enterprise_value_source", "TEXT"),
        ],
    )
    _rebuild_fundamental_points_available_at_pk(conn)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_dataset_fundamental_points_symbol_date ON dataset_fundamental_points(symbol, date)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_dataset_fundamental_points_symbol_available_at ON dataset_fundamental_points(symbol, available_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_bond_fixed_income_instrument_date ON bond_fixed_income_snapshots(instrument_id, snapshot_date)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_bond_fixed_income_source_status ON bond_fixed_income_snapshots(source, refresh_status, deleted_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_bond_fixed_income_symbol_date ON bond_fixed_income_snapshots(symbol, snapshot_date)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_bond_fixed_income_identifiers ON bond_fixed_income_snapshots(isin, cusip)"
    )
    conn.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_bond_fixed_income_active_natural_key
        ON bond_fixed_income_snapshots(instrument_id, snapshot_date, source)
        WHERE deleted_at IS NULL
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_universe_membership_effective ON universe_membership_snapshots(effective_date, symbol)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_universe_membership_snapshot_symbol_effective ON universe_membership_snapshots(universe_snapshot_id, symbol, effective_date)"
    )
    conn.commit()


class MarketDataRepository:
    def __init__(self, database_path: str | Path = "data/market_data.sqlite3"):
        self.path = Path(database_path)
        if self.path.parent and self.path.parent != Path("."):
            self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as conn:
            initialize_market_data_schema(conn)

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, timeout=30.0)
        conn.row_factory = _row_factory
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 30000")
        try:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA synchronous = NORMAL")
        except sqlite3.OperationalError as exc:
            if "database is locked" not in str(exc).lower():
                raise
        return conn

    def _normalize_symbol(self, value: str) -> str:
        return _normalize_symbol(value)

    def _normalize_index_key(self, value: str) -> str:
        return _normalize_index_key(value)

    def _merge_action_entry(self, existing: dict[str, Any], incoming: Mapping[str, Any]) -> dict[str, Any]:
        merged = dict(existing)
        incoming_payload = _ensure_json_dict(incoming.get("payload"))
        existing_payload = _ensure_json_dict(merged.get("payload"))
        if merged.get("value") is None and incoming.get("value") is not None:
            merged["value"] = incoming.get("value")
        if not merged.get("source") and incoming.get("source"):
            merged["source"] = str(incoming.get("source") or "")
        if not merged.get("fallback_source") and incoming.get("fallback_source"):
            merged["fallback_source"] = incoming.get("fallback_source")
        for key, value in incoming_payload.items():
            if key not in existing_payload or existing_payload.get(key) is None:
                existing_payload[key] = value
        merged["payload"] = existing_payload
        return merged

    def _dedupe_actions_for_storage(
        self,
        actions: Iterable[Mapping[str, Any]],
        *,
        default_source: str = "",
        default_fallback_source: Any = None,
    ) -> list[dict[str, Any]]:
        deduped: dict[tuple[str, str, str], dict[str, Any]] = {}
        for action in actions:
            normalized = {
                "symbol": self._normalize_symbol(str(action.get("symbol") or "")),
                "date": str(action.get("date") or action.get("event_date") or ""),
                "action_type": str(action.get("action_type") or action.get("type") or action.get("event_type") or "unknown"),
                "value": action.get("value"),
                "source": str(action.get("source") or default_source or ""),
                "fallback_source": action.get("fallback_source", default_fallback_source),
                "payload": _ensure_json_dict(action.get("payload")),
            }
            key = (normalized["symbol"], normalized["date"], normalized["action_type"])
            existing = deduped.get(key)
            if existing is None:
                deduped[key] = normalized
                continue
            deduped[key] = self._merge_action_entry(existing, normalized)
        return list(deduped.values())

    def replace_bars(self, symbol: str, bars: Iterable[Mapping[str, Any]]) -> None:
        normalized_symbol = self._normalize_symbol(symbol)
        rows = [
            (
                normalized_symbol,
                str(bar["date"]),
                bar.get("open"),
                bar.get("high"),
                bar.get("low"),
                bar.get("close"),
                bar.get("adj_close", bar.get("close")),
                bar.get("volume"),
            )
            for bar in bars
        ]
        with self.connect() as conn:
            conn.execute("DELETE FROM market_bars WHERE symbol = ?", (normalized_symbol,))
            conn.executemany(
                """
                INSERT INTO market_bars (symbol, date, open, high, low, close, adj_close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )

    def replace_actions(self, symbol: str, actions: Iterable[Mapping[str, Any]]) -> None:
        normalized_symbol = self._normalize_symbol(symbol)
        normalized_actions = self._dedupe_actions_for_storage(
            (dict(action, symbol=normalized_symbol) for action in actions),
        )
        rows = [
            (
                normalized_symbol,
                str(action["date"]),
                str(action["action_type"]),
                action.get("value"),
                dumps(_ensure_json_dict(action.get("payload")) or dict(action)),
            )
            for action in normalized_actions
        ]
        with self.connect() as conn:
            conn.execute("DELETE FROM market_actions WHERE symbol = ?", (normalized_symbol,))
            conn.executemany(
                """
                INSERT INTO market_actions (symbol, date, action_type, value, payload_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                rows,
            )

    def replace_coverages(self, coverages: Iterable[CoverageSummary | Mapping[str, Any]]) -> None:
        rows = []
        for coverage in coverages:
            item = coverage if isinstance(coverage, Mapping) else {
                "symbol": coverage.symbol,
                "start_date": coverage.start_date,
                "end_date": coverage.end_date,
                "trade_days": coverage.trade_days,
            }
            rows.append(
                (
                    self._normalize_symbol(str(item["symbol"])),
                    item.get("start_date"),
                    item.get("end_date"),
                    int(item.get("trade_days") or 0),
                )
            )
        with self.connect() as conn:
            conn.execute("DELETE FROM market_coverages")
            conn.executemany(
                "INSERT INTO market_coverages (symbol, start_date, end_date, trade_days) VALUES (?, ?, ?, ?)",
                rows,
            )

    def _upsert_dataset_snapshot(self, conn: sqlite3.Connection, snapshot: Mapping[str, Any]) -> str:
        snapshot_id = str(snapshot["id"])
        now = str(snapshot.get("updated_at") or iso_now())
        created_at = str(snapshot.get("created_at") or now)
        conn.execute(
            """
            INSERT INTO dataset_snapshots (
                id, name, status, as_of, freshness_label, start_date, end_date,
                row_count, source, fallback_source, blocker_json, metadata_json,
                created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                status = excluded.status,
                as_of = excluded.as_of,
                freshness_label = excluded.freshness_label,
                start_date = excluded.start_date,
                end_date = excluded.end_date,
                row_count = excluded.row_count,
                source = excluded.source,
                fallback_source = excluded.fallback_source,
                blocker_json = excluded.blocker_json,
                metadata_json = excluded.metadata_json,
                updated_at = excluded.updated_at
            """,
            (
                snapshot_id,
                str(snapshot.get("name") or snapshot_id),
                str(snapshot.get("status") or "INCOMPLETE"),
                snapshot.get("as_of"),
                snapshot.get("freshness_label"),
                snapshot.get("start_date"),
                snapshot.get("end_date"),
                int(snapshot.get("row_count") or 0),
                str(snapshot.get("source") or ""),
                snapshot.get("fallback_source"),
                dumps(_ensure_json_dict(snapshot.get("blocker"))),
                dumps(_ensure_json_dict(snapshot.get("metadata"))),
                created_at,
                now,
            ),
        )
        return snapshot_id

    def replace_dataset_snapshot(
        self,
        snapshot: Mapping[str, Any],
        *,
        price_bars: Iterable[Mapping[str, Any]] = (),
        corporate_actions: Iterable[Mapping[str, Any]] = (),
        symbol_coverage: Iterable[CoverageSummary | Mapping[str, Any]] = (),
        index_valuations: Iterable[Mapping[str, Any]] = (),
        index_valuation_coverage: Iterable[IndexValuationCoverageSummary | Mapping[str, Any]] = (),
    ) -> str:
        dataset_snapshot_id = str(snapshot["id"])
        with self.connect() as conn:
            self._upsert_dataset_snapshot(conn, snapshot)
            conn.execute("DELETE FROM dataset_price_bars WHERE dataset_snapshot_id = ?", (dataset_snapshot_id,))
            conn.execute("DELETE FROM dataset_corporate_actions WHERE dataset_snapshot_id = ?", (dataset_snapshot_id,))
            conn.execute("DELETE FROM dataset_symbol_coverage WHERE dataset_snapshot_id = ?", (dataset_snapshot_id,))
            conn.execute("DELETE FROM dataset_index_valuations WHERE dataset_snapshot_id = ?", (dataset_snapshot_id,))
            conn.execute("DELETE FROM dataset_index_valuation_coverage WHERE dataset_snapshot_id = ?", (dataset_snapshot_id,))
            conn.execute("DELETE FROM dataset_fundamental_points WHERE dataset_snapshot_id = ?", (dataset_snapshot_id,))
            conn.execute("DELETE FROM dataset_fundamental_coverage WHERE dataset_snapshot_id = ?", (dataset_snapshot_id,))

            price_rows = [
                (
                    dataset_snapshot_id,
                    self._normalize_symbol(str(bar["symbol"])),
                    str(bar["date"]),
                    bar.get("open"),
                    bar.get("high"),
                    bar.get("low"),
                    bar.get("close"),
                    bar.get("adj_close", bar.get("close")),
                    bar.get("volume"),
                    str(bar.get("source") or snapshot.get("source") or ""),
                    bar.get("fallback_source", snapshot.get("fallback_source")),
                    dumps(_ensure_json_dict(bar.get("metadata"))),
                )
                for bar in price_bars
            ]
            if price_rows:
                conn.executemany(
                    """
                    INSERT INTO dataset_price_bars (
                        dataset_snapshot_id, symbol, date, open, high, low, close, adj_close,
                        volume, source, fallback_source, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    price_rows,
                )

            normalized_actions = self._dedupe_actions_for_storage(
                corporate_actions,
                default_source=str(snapshot.get("source") or ""),
                default_fallback_source=snapshot.get("fallback_source"),
            )
            action_rows = [
                (
                    dataset_snapshot_id,
                    action["symbol"],
                    str(action["date"]),
                    str(action["action_type"]),
                    action.get("value"),
                    str(action.get("source") or snapshot.get("source") or ""),
                    action.get("fallback_source", snapshot.get("fallback_source")),
                    dumps(_ensure_json_dict(action.get("payload"))),
                )
                for action in normalized_actions
            ]
            if action_rows:
                conn.executemany(
                    """
                    INSERT INTO dataset_corporate_actions (
                        dataset_snapshot_id, symbol, event_date, event_type, value,
                        source, fallback_source, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    action_rows,
                )

            coverage_rows = []
            for coverage in symbol_coverage:
                item = coverage if isinstance(coverage, Mapping) else {
                    "symbol": coverage.symbol,
                    "start_date": coverage.start_date,
                    "end_date": coverage.end_date,
                    "trade_days": coverage.trade_days,
                }
                coverage_rows.append(
                    (
                        dataset_snapshot_id,
                        self._normalize_symbol(str(item["symbol"])),
                        item.get("start_date"),
                        item.get("end_date"),
                        int(item.get("trade_days") or 0),
                        str(item.get("source") or snapshot.get("source") or ""),
                        item.get("fallback_source", snapshot.get("fallback_source")),
                        dumps(_ensure_json_dict(item.get("metadata"))),
                    )
                )
            if coverage_rows:
                conn.executemany(
                    """
                    INSERT INTO dataset_symbol_coverage (
                        dataset_snapshot_id, symbol, start_date, end_date, trade_days,
                        source, fallback_source, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    coverage_rows,
                )

            valuation_rows = [
                (
                    dataset_snapshot_id,
                    self._normalize_index_key(str(item.get("index_key") or "")),
                    str(item.get("date") or ""),
                    self._normalize_symbol(str(item.get("proxy_symbol") or "")),
                    item.get("pe_ttm"),
                    item.get("pe_ttm_percentile_10y"),
                    str(item.get("source") or snapshot.get("source") or ""),
                    item.get("fallback_source", snapshot.get("fallback_source")),
                    dumps(_ensure_json_dict(item.get("metadata"))),
                )
                for item in index_valuations
                if str(item.get("index_key") or "").strip() and str(item.get("date") or "").strip()
            ]
            if valuation_rows:
                conn.executemany(
                    """
                    INSERT INTO dataset_index_valuations (
                        dataset_snapshot_id, index_key, date, proxy_symbol, pe_ttm,
                        pe_ttm_percentile_10y, source, fallback_source, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    valuation_rows,
                )

            valuation_coverage_rows = []
            for coverage in index_valuation_coverage:
                item = coverage if isinstance(coverage, Mapping) else {
                    "index_key": coverage.index_key,
                    "start_date": coverage.start_date,
                    "end_date": coverage.end_date,
                    "observation_count": coverage.observation_count,
                    "latest_date": coverage.latest_date,
                    "latest_pe_ttm": coverage.latest_pe_ttm,
                    "latest_percentile_10y": coverage.latest_percentile_10y,
                }
                valuation_coverage_rows.append(
                    (
                        dataset_snapshot_id,
                        self._normalize_index_key(str(item.get("index_key") or "")),
                        item.get("start_date"),
                        item.get("end_date"),
                        int(item.get("observation_count") or 0),
                        item.get("latest_date"),
                        item.get("latest_pe_ttm"),
                        item.get("latest_percentile_10y"),
                        str(item.get("source") or snapshot.get("source") or ""),
                        item.get("fallback_source", snapshot.get("fallback_source")),
                        dumps(_ensure_json_dict(item.get("metadata"))),
                    )
                )
            if valuation_coverage_rows:
                conn.executemany(
                    """
                    INSERT INTO dataset_index_valuation_coverage (
                        dataset_snapshot_id, index_key, start_date, end_date, observation_count,
                        latest_date, latest_pe_ttm, latest_percentile_10y, source, fallback_source, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    valuation_coverage_rows,
                )
        return dataset_snapshot_id

    def replace_fundamental_snapshot(
        self,
        snapshot: Mapping[str, Any],
        *,
        fundamental_points: Iterable[Mapping[str, Any]] = (),
        fundamental_coverage: Iterable[Mapping[str, Any]] = (),
    ) -> str:
        dataset_snapshot_id = str(snapshot["id"])
        with self.connect() as conn:
            self._upsert_dataset_snapshot(conn, snapshot)
            conn.execute("DELETE FROM dataset_fundamental_points WHERE dataset_snapshot_id = ?", (dataset_snapshot_id,))
            conn.execute("DELETE FROM dataset_fundamental_coverage WHERE dataset_snapshot_id = ?", (dataset_snapshot_id,))

            point_rows = [
                (
                    dataset_snapshot_id,
                    self._normalize_symbol(str(item["symbol"])),
                    str(item["date"]),
                    item.get("period_end_date") or item.get("date"),
                    item.get("available_at") or item.get("date"),
                    item.get("ltm_earnings"),
                    item.get("market_cap"),
                    item.get("book_value_equity"),
                    item.get("operating_cash_flow"),
                    item.get("capex"),
                    item.get("enterprise_value"),
                    item.get("total_shares"),
                    item.get("shares_outstanding") or item.get("total_shares"),
                    item.get("total_debt"),
                    item.get("cash_and_equivalents"),
                    item.get("provider_market_cap"),
                    item.get("provider_enterprise_value"),
                    item.get("market_cap_source"),
                    item.get("enterprise_value_source"),
                    str(item.get("source") or snapshot.get("source") or ""),
                    item.get("fallback_source", snapshot.get("fallback_source")),
                    dumps(_ensure_json_dict(item.get("metadata"))),
                )
                for item in fundamental_points
                if str(item.get("symbol") or "").strip() and str(item.get("date") or "").strip()
            ]
            if point_rows:
                conn.executemany(
                    """
                    INSERT INTO dataset_fundamental_points (
                        dataset_snapshot_id, symbol, date, period_end_date, available_at,
                        ltm_earnings, market_cap, book_value_equity,
                        operating_cash_flow, capex, enterprise_value, total_shares,
                        shares_outstanding, total_debt, cash_and_equivalents,
                        provider_market_cap, provider_enterprise_value,
                        market_cap_source, enterprise_value_source,
                        source, fallback_source, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    point_rows,
                )

            coverage_rows = [
                (
                    dataset_snapshot_id,
                    self._normalize_symbol(str(item["symbol"])),
                    item.get("start_date"),
                    item.get("end_date"),
                    int(item.get("observation_count") or 0),
                    dumps([str(field) for field in (item.get("fields") or []) if str(field).strip()]),
                    str(item.get("source") or snapshot.get("source") or ""),
                    item.get("fallback_source", snapshot.get("fallback_source")),
                    dumps(_ensure_json_dict(item.get("metadata"))),
                )
                for item in fundamental_coverage
                if str(item.get("symbol") or "").strip()
            ]
            if coverage_rows:
                conn.executemany(
                    """
                    INSERT INTO dataset_fundamental_coverage (
                        dataset_snapshot_id, symbol, start_date, end_date, observation_count,
                        fields_json, source, fallback_source, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    coverage_rows,
                )
        return dataset_snapshot_id

    def merge_dataset_snapshot(
        self,
        snapshot: Mapping[str, Any],
        *,
        price_bars: Iterable[Mapping[str, Any]] = (),
        corporate_actions: Iterable[Mapping[str, Any]] = (),
        symbol_coverage: Iterable[CoverageSummary | Mapping[str, Any]] = (),
        index_valuations: Iterable[Mapping[str, Any]] = (),
        index_valuation_coverage: Iterable[IndexValuationCoverageSummary | Mapping[str, Any]] = (),
    ) -> str:
        dataset_snapshot_id = str(snapshot["id"])
        with self.connect() as conn:
            self._upsert_dataset_snapshot(conn, snapshot)

            price_rows = [
                (
                    dataset_snapshot_id,
                    self._normalize_symbol(str(bar["symbol"])),
                    str(bar["date"]),
                    bar.get("open"),
                    bar.get("high"),
                    bar.get("low"),
                    bar.get("close"),
                    bar.get("adj_close", bar.get("close")),
                    bar.get("volume"),
                    str(bar.get("source") or snapshot.get("source") or ""),
                    bar.get("fallback_source", snapshot.get("fallback_source")),
                    dumps(_ensure_json_dict(bar.get("metadata"))),
                )
                for bar in price_bars
            ]
            if price_rows:
                conn.executemany(
                    """
                    INSERT OR REPLACE INTO dataset_price_bars (
                        dataset_snapshot_id, symbol, date, open, high, low, close, adj_close,
                        volume, source, fallback_source, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    price_rows,
                )

            normalized_actions = self._dedupe_actions_for_storage(
                corporate_actions,
                default_source=str(snapshot.get("source") or ""),
                default_fallback_source=snapshot.get("fallback_source"),
            )
            action_rows = [
                (
                    dataset_snapshot_id,
                    action["symbol"],
                    str(action["date"]),
                    str(action["action_type"]),
                    action.get("value"),
                    str(action.get("source") or snapshot.get("source") or ""),
                    action.get("fallback_source", snapshot.get("fallback_source")),
                    dumps(_ensure_json_dict(action.get("payload"))),
                )
                for action in normalized_actions
            ]
            if action_rows:
                conn.executemany(
                    """
                    INSERT OR REPLACE INTO dataset_corporate_actions (
                        dataset_snapshot_id, symbol, event_date, event_type, value,
                        source, fallback_source, payload_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    action_rows,
                )

            coverage_rows = []
            for coverage in symbol_coverage:
                item = coverage if isinstance(coverage, Mapping) else {
                    "symbol": coverage.symbol,
                    "start_date": coverage.start_date,
                    "end_date": coverage.end_date,
                    "trade_days": coverage.trade_days,
                }
                coverage_rows.append(
                    (
                        dataset_snapshot_id,
                        self._normalize_symbol(str(item["symbol"])),
                        item.get("start_date"),
                        item.get("end_date"),
                        int(item.get("trade_days") or 0),
                        str(item.get("source") or snapshot.get("source") or ""),
                        item.get("fallback_source", snapshot.get("fallback_source")),
                        dumps(_ensure_json_dict(item.get("metadata"))),
                    )
                )
            if coverage_rows:
                conn.executemany(
                    """
                    INSERT OR REPLACE INTO dataset_symbol_coverage (
                        dataset_snapshot_id, symbol, start_date, end_date, trade_days,
                        source, fallback_source, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    coverage_rows,
                )

            valuation_rows = [
                (
                    dataset_snapshot_id,
                    self._normalize_index_key(str(item.get("index_key") or "")),
                    str(item.get("date") or ""),
                    self._normalize_symbol(str(item.get("proxy_symbol") or "")),
                    item.get("pe_ttm"),
                    item.get("pe_ttm_percentile_10y"),
                    str(item.get("source") or snapshot.get("source") or ""),
                    item.get("fallback_source", snapshot.get("fallback_source")),
                    dumps(_ensure_json_dict(item.get("metadata"))),
                )
                for item in index_valuations
                if str(item.get("index_key") or "").strip() and str(item.get("date") or "").strip()
            ]
            if valuation_rows:
                conn.executemany(
                    """
                    INSERT OR REPLACE INTO dataset_index_valuations (
                        dataset_snapshot_id, index_key, date, proxy_symbol, pe_ttm,
                        pe_ttm_percentile_10y, source, fallback_source, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    valuation_rows,
                )

            valuation_coverage_rows = []
            for coverage in index_valuation_coverage:
                item = coverage if isinstance(coverage, Mapping) else {
                    "index_key": coverage.index_key,
                    "start_date": coverage.start_date,
                    "end_date": coverage.end_date,
                    "observation_count": coverage.observation_count,
                    "latest_date": coverage.latest_date,
                    "latest_pe_ttm": coverage.latest_pe_ttm,
                    "latest_percentile_10y": coverage.latest_percentile_10y,
                }
                valuation_coverage_rows.append(
                    (
                        dataset_snapshot_id,
                        self._normalize_index_key(str(item.get("index_key") or "")),
                        item.get("start_date"),
                        item.get("end_date"),
                        int(item.get("observation_count") or 0),
                        item.get("latest_date"),
                        item.get("latest_pe_ttm"),
                        item.get("latest_percentile_10y"),
                        str(item.get("source") or snapshot.get("source") or ""),
                        item.get("fallback_source", snapshot.get("fallback_source")),
                        dumps(_ensure_json_dict(item.get("metadata"))),
                    )
                )
            if valuation_coverage_rows:
                conn.executemany(
                    """
                    INSERT OR REPLACE INTO dataset_index_valuation_coverage (
                        dataset_snapshot_id, index_key, start_date, end_date, observation_count,
                        latest_date, latest_pe_ttm, latest_percentile_10y, source, fallback_source, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    valuation_coverage_rows,
                )
        return dataset_snapshot_id

    def replace_universe_snapshot(
        self,
        snapshot: Mapping[str, Any],
        *,
        memberships: Iterable[Mapping[str, Any]] = (),
    ) -> str:
        universe_snapshot_id = str(snapshot["id"])
        now = str(snapshot.get("updated_at") or iso_now())
        created_at = str(snapshot.get("created_at") or now)
        with self.connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO universe_snapshots (
                    id, universe_key, name, status, as_of, freshness_label, window_start, window_end,
                    anchor_schedule, member_count, source, fallback_source, blocker_json, metadata_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    universe_snapshot_id,
                    str(snapshot.get("universe_key") or universe_snapshot_id),
                    str(snapshot.get("name") or universe_snapshot_id),
                    str(snapshot.get("status") or "INCOMPLETE"),
                    snapshot.get("as_of"),
                    snapshot.get("freshness_label"),
                    snapshot.get("window_start"),
                    snapshot.get("window_end"),
                    str(snapshot.get("anchor_schedule") or DEFAULT_UNIVERSE_ANCHOR_SCHEDULE),
                    int(snapshot.get("member_count") or 0),
                    str(snapshot.get("source") or ""),
                    snapshot.get("fallback_source"),
                    dumps(_ensure_json_dict(snapshot.get("blocker"))),
                    dumps(_ensure_json_dict(snapshot.get("metadata"))),
                    created_at,
                    now,
                ),
            )
            conn.execute("DELETE FROM universe_membership_snapshots WHERE universe_snapshot_id = ?", (universe_snapshot_id,))

            membership_rows = [
                (
                    universe_snapshot_id,
                    str(membership["effective_date"]),
                    self._normalize_symbol(str(membership["symbol"])),
                    membership.get("raw_symbol"),
                    str(membership.get("membership_status") or "ACTIVE"),
                    str(membership.get("source") or snapshot.get("source") or ""),
                    membership.get("fallback_source", snapshot.get("fallback_source")),
                    dumps(_ensure_json_dict(membership.get("metadata"))),
                )
                for membership in memberships
            ]
            if membership_rows:
                conn.executemany(
                    """
                    INSERT INTO universe_membership_snapshots (
                        universe_snapshot_id, effective_date, symbol, raw_symbol, membership_status,
                        source, fallback_source, metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    membership_rows,
                )
        return universe_snapshot_id

    def list_dataset_snapshots(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM dataset_snapshots ORDER BY name ASC, updated_at DESC").fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["blocker"] = loads(item.pop("blocker_json", None), {})
            item["metadata"] = loads(item.pop("metadata_json", None), {})
            items.append(item)
        return items

    def list_universe_snapshots(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM universe_snapshots ORDER BY name ASC, updated_at DESC").fetchall()
        items: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["blocker"] = loads(item.pop("blocker_json", None), {})
            item["metadata"] = loads(item.pop("metadata_json", None), {})
            items.append(item)
        return items

    def load_dataset_snapshot_rows(self, dataset_snapshot_id: str) -> dict[str, list[dict[str, Any]]]:
        with self.connect() as conn:
            price_rows = conn.execute(
                "SELECT * FROM dataset_price_bars WHERE dataset_snapshot_id = ? ORDER BY symbol, date",
                (dataset_snapshot_id,),
            ).fetchall()
            action_rows = conn.execute(
                """
                SELECT * FROM dataset_corporate_actions
                WHERE dataset_snapshot_id = ?
                ORDER BY symbol, event_date, event_type
                """,
                (dataset_snapshot_id,),
            ).fetchall()
            coverage_rows = conn.execute(
                "SELECT * FROM dataset_symbol_coverage WHERE dataset_snapshot_id = ? ORDER BY symbol",
                (dataset_snapshot_id,),
            ).fetchall()
            valuation_rows = conn.execute(
                "SELECT * FROM dataset_index_valuations WHERE dataset_snapshot_id = ? ORDER BY index_key, date",
                (dataset_snapshot_id,),
            ).fetchall()
            valuation_coverage_rows = conn.execute(
                """
                SELECT * FROM dataset_index_valuation_coverage
                WHERE dataset_snapshot_id = ?
                ORDER BY index_key
                """,
                (dataset_snapshot_id,),
            ).fetchall()
        return {
            "price_bars": [self._decode_json_row(dict(row), "metadata_json") for row in price_rows],
            "corporate_actions": [self._decode_json_row(dict(row), "payload_json") for row in action_rows],
            "symbol_coverage": [self._decode_json_row(dict(row), "metadata_json") for row in coverage_rows],
            "index_valuations": [self._decode_json_row(dict(row), "metadata_json") for row in valuation_rows],
            "index_valuation_coverage": [
                self._decode_json_row(dict(row), "metadata_json") for row in valuation_coverage_rows
            ],
        }

    def load_dataset_symbol_coverage(self, dataset_snapshot_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM dataset_symbol_coverage WHERE dataset_snapshot_id = ? ORDER BY symbol",
                (dataset_snapshot_id,),
            ).fetchall()
        return [self._decode_json_row(dict(row), "metadata_json") for row in rows]

    def count_dataset_snapshot_rows(self, dataset_snapshot_id: str) -> dict[str, int]:
        with self.connect() as conn:
            price_row = conn.execute(
                "SELECT COUNT(*) AS count FROM dataset_price_bars WHERE dataset_snapshot_id = ?",
                (dataset_snapshot_id,),
            ).fetchone()
            action_row = conn.execute(
                "SELECT COUNT(*) AS count FROM dataset_corporate_actions WHERE dataset_snapshot_id = ?",
                (dataset_snapshot_id,),
            ).fetchone()
            coverage_row = conn.execute(
                "SELECT COUNT(*) AS count FROM dataset_symbol_coverage WHERE dataset_snapshot_id = ?",
                (dataset_snapshot_id,),
            ).fetchone()
            valuation_row = conn.execute(
                "SELECT COUNT(*) AS count FROM dataset_index_valuations WHERE dataset_snapshot_id = ?",
                (dataset_snapshot_id,),
            ).fetchone()
            valuation_coverage_row = conn.execute(
                "SELECT COUNT(*) AS count FROM dataset_index_valuation_coverage WHERE dataset_snapshot_id = ?",
                (dataset_snapshot_id,),
            ).fetchone()
            fundamental_point_row = conn.execute(
                "SELECT COUNT(*) AS count FROM dataset_fundamental_points WHERE dataset_snapshot_id = ?",
                (dataset_snapshot_id,),
            ).fetchone()
            fundamental_coverage_row = conn.execute(
                "SELECT COUNT(*) AS count FROM dataset_fundamental_coverage WHERE dataset_snapshot_id = ?",
                (dataset_snapshot_id,),
            ).fetchone()
        return {
            "price_bars": int((price_row or {}).get("count") or 0),
            "corporate_actions": int((action_row or {}).get("count") or 0),
            "symbol_coverage": int((coverage_row or {}).get("count") or 0),
            "index_valuations": int((valuation_row or {}).get("count") or 0),
            "index_valuation_coverage": int((valuation_coverage_row or {}).get("count") or 0),
            "fundamental_points": int((fundamental_point_row or {}).get("count") or 0),
            "fundamental_coverage": int((fundamental_coverage_row or {}).get("count") or 0),
        }

    def summarize_dataset_symbols(
        self,
        dataset_snapshot_id: str,
        symbols: Iterable[str] | None = None,
    ) -> list[dict[str, Any]]:
        normalized_symbols = [self._normalize_symbol(str(symbol)) for symbol in (symbols or []) if str(symbol).strip()]
        with self.connect() as conn:
            symbol_filter = ""
            params: list[Any] = [dataset_snapshot_id]
            if normalized_symbols:
                placeholders = ",".join("?" for _ in normalized_symbols)
                symbol_filter = f" AND symbol IN ({placeholders})"
                params.extend(normalized_symbols)
            price_rows = conn.execute(
                f"""
                SELECT
                    symbol,
                    MIN(date) AS start_date,
                    MAX(date) AS end_date,
                    COUNT(*) AS trade_days
                FROM dataset_price_bars
                WHERE dataset_snapshot_id = ?{symbol_filter}
                GROUP BY symbol
                ORDER BY symbol
                """,
                params,
            ).fetchall()
            if price_rows:
                return [dict(row) for row in price_rows]

            params = [dataset_snapshot_id]
            if normalized_symbols:
                params.extend(normalized_symbols)
            action_rows = conn.execute(
                f"""
                SELECT
                    symbol,
                    MIN(event_date) AS start_date,
                    MAX(event_date) AS end_date,
                    COUNT(*) AS trade_days
                FROM dataset_corporate_actions
                WHERE dataset_snapshot_id = ?{symbol_filter}
                GROUP BY symbol
                ORDER BY symbol
                """,
                params,
            ).fetchall()
        return [dict(row) for row in action_rows]

    def load_dataset_index_valuations(
        self,
        dataset_snapshot_id: str,
        index_keys: Iterable[str] | None = None,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        sql = """
            SELECT *
            FROM dataset_index_valuations
            WHERE dataset_snapshot_id = ?
        """
        params: list[Any] = [dataset_snapshot_id]
        normalized_keys = [self._normalize_index_key(key) for key in (index_keys or []) if str(key).strip()]
        if normalized_keys:
            sql += f" AND index_key IN ({','.join('?' for _ in normalized_keys)})"
            params.extend(normalized_keys)
        if start_date:
            sql += " AND date >= ?"
            params.append(start_date)
        if end_date:
            sql += " AND date <= ?"
            params.append(end_date)
        sql += " ORDER BY index_key ASC, date ASC"
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            decoded = self._decode_json_row(dict(row), "metadata_json")
            index_key = str(decoded.get("index_key") or "")
            grouped.setdefault(index_key, []).append(decoded)
        return grouped

    def load_dataset_index_valuation_coverage(
        self,
        dataset_snapshot_id: str,
        index_keys: Iterable[str] | None = None,
    ) -> list[dict[str, Any]]:
        sql = """
            SELECT *
            FROM dataset_index_valuation_coverage
            WHERE dataset_snapshot_id = ?
        """
        params: list[Any] = [dataset_snapshot_id]
        normalized_keys = [self._normalize_index_key(key) for key in (index_keys or []) if str(key).strip()]
        if normalized_keys:
            sql += f" AND index_key IN ({','.join('?' for _ in normalized_keys)})"
            params.extend(normalized_keys)
        sql += " ORDER BY index_key ASC"
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._decode_json_row(dict(row), "metadata_json") for row in rows]

    def summarize_dataset_index_valuations(self, dataset_snapshot_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT
                    index_key,
                    MIN(date) AS start_date,
                    MAX(date) AS end_date,
                    COUNT(*) AS observation_count,
                    MAX(date) AS latest_date
                FROM dataset_index_valuations
                WHERE dataset_snapshot_id = ?
                GROUP BY index_key
                ORDER BY index_key
                """,
                (dataset_snapshot_id,),
            ).fetchall()
        return [dict(row) for row in rows]

    def load_dataset_price_bars(
        self,
        dataset_snapshot_id: str,
        symbols: Iterable[str] | None = None,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
        include_metadata: bool = True,
    ) -> dict[str, list[dict[str, Any]]]:
        selected_columns = (
            "symbol, date, open, high, low, close, adj_close, volume, source, fallback_source, metadata_json"
            if include_metadata
            else "symbol, date, open, high, low, close, adj_close, volume"
        )
        sql = f"SELECT {selected_columns} FROM dataset_price_bars WHERE dataset_snapshot_id = ?"
        params: list[Any] = [dataset_snapshot_id]
        normalized_symbols = [self._normalize_symbol(symbol) for symbol in (symbols or []) if symbol]
        if normalized_symbols:
            sql += f" AND symbol IN ({','.join('?' for _ in normalized_symbols)})"
            params.extend(normalized_symbols)
        if start_date:
            sql += " AND date >= ?"
            params.append(start_date)
        if end_date:
            sql += " AND date <= ?"
            params.append(end_date)
        sql += " ORDER BY symbol ASC, date ASC"
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            if include_metadata:
                decoded = self._decode_json_row(dict(row), "metadata_json")
                symbol = str(decoded["symbol"])
                grouped.setdefault(symbol, []).append(decoded)
                continue
            symbol = str(row["symbol"])
            grouped.setdefault(symbol, []).append(
                {
                    "symbol": symbol,
                    "date": row["date"],
                    "open": row["open"],
                    "high": row["high"],
                    "low": row["low"],
                    "close": row["close"],
                    "adj_close": row["adj_close"],
                    "volume": row["volume"],
                }
            )
        return grouped

    def load_dataset_fundamental_points(
        self,
        dataset_snapshot_id: str,
        symbols: Iterable[str] | None = None,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
        as_of_date: str | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        sql = """
            SELECT *
            FROM dataset_fundamental_points
            WHERE dataset_snapshot_id = ?
        """
        params: list[Any] = [dataset_snapshot_id]
        normalized_symbols = [self._normalize_symbol(symbol) for symbol in (symbols or []) if symbol]
        if normalized_symbols:
            sql += f" AND symbol IN ({','.join('?' for _ in normalized_symbols)})"
            params.extend(normalized_symbols)
        if start_date:
            sql += " AND COALESCE(available_at, date) >= ?"
            params.append(start_date)
        if end_date:
            sql += " AND COALESCE(available_at, date) <= ?"
            params.append(end_date)
        if as_of_date:
            sql += " AND COALESCE(available_at, date) <= ?"
            params.append(as_of_date)
        sql += " ORDER BY symbol ASC, COALESCE(available_at, date) ASC, date ASC"
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            decoded = self._decode_json_row(dict(row), "metadata_json")
            symbol = str(decoded["symbol"])
            grouped.setdefault(symbol, []).append(decoded)
        return grouped

    def load_dataset_fundamental_coverage(
        self,
        dataset_snapshot_id: str,
        symbols: Iterable[str] | None = None,
    ) -> list[dict[str, Any]]:
        sql = """
            SELECT *
            FROM dataset_fundamental_coverage
            WHERE dataset_snapshot_id = ?
        """
        params: list[Any] = [dataset_snapshot_id]
        normalized_symbols = [self._normalize_symbol(symbol) for symbol in (symbols or []) if symbol]
        if normalized_symbols:
            sql += f" AND symbol IN ({','.join('?' for _ in normalized_symbols)})"
            params.extend(normalized_symbols)
        sql += " ORDER BY symbol ASC"
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        decoded_rows = []
        for row in rows:
            item = self._decode_json_row(dict(row), "metadata_json")
            item["fields"] = [str(field) for field in loads(item.pop("fields_json", "[]"), [])]
            decoded_rows.append(item)
        return decoded_rows

    def load_universe_memberships(
        self,
        *,
        universe_snapshot_id: str | None = None,
        universe_key: str | None = None,
        effective_date: str | None = None,
        effective_date_lte: str | None = None,
        symbols: Iterable[str] | None = None,
        active_only: bool = False,
    ) -> list[dict[str, Any]]:
        sql = "SELECT ums.* FROM universe_membership_snapshots ums"
        if universe_key:
            sql += " JOIN universe_snapshots us ON us.id = ums.universe_snapshot_id"
        filters: list[str] = []
        params: list[Any] = []
        if universe_snapshot_id:
            filters.append("ums.universe_snapshot_id = ?")
            params.append(universe_snapshot_id)
        if universe_key:
            filters.append("us.universe_key = ?")
            params.append(universe_key)
        if effective_date:
            filters.append("ums.effective_date = ?")
            params.append(effective_date)
        if effective_date_lte:
            filters.append("ums.effective_date <= ?")
            params.append(effective_date_lte)
        normalized_symbols: list[str] = []
        seen_symbols: set[str] = set()
        for symbol in symbols or []:
            normalized_symbol = self._normalize_symbol(str(symbol))
            if normalized_symbol and normalized_symbol not in seen_symbols:
                normalized_symbols.append(normalized_symbol)
                seen_symbols.add(normalized_symbol)
        if normalized_symbols:
            filters.append(f"ums.symbol IN ({','.join('?' for _ in normalized_symbols)})")
            params.extend(normalized_symbols)
        if active_only:
            inactive_statuses = ("REMOVED", "DELETED", "INACTIVE", "OUT", "EXCLUDED")
            filters.append(
                "UPPER(COALESCE(NULLIF(ums.membership_status, ''), 'ACTIVE')) "
                f"NOT IN ({','.join('?' for _ in inactive_statuses)})"
            )
            params.extend(inactive_statuses)
        if filters:
            sql += " WHERE " + " AND ".join(filters)
        sql += " ORDER BY ums.effective_date ASC, ums.symbol ASC"
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._decode_json_row(dict(row), "metadata_json") for row in rows]

    def list_universe_membership_symbols(self) -> list[str]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT DISTINCT symbol
                FROM universe_membership_snapshots
                WHERE COALESCE(symbol, '') <> ''
                ORDER BY symbol ASC
                """
            ).fetchall()
        symbols: list[str] = []
        seen: set[str] = set()
        for row in rows:
            symbol = self._normalize_symbol(str(row["symbol"]))
            if symbol and symbol not in seen:
                symbols.append(symbol)
                seen.add(symbol)
        return symbols

    def snapshot_table_counts(self) -> dict[str, int]:
        table_names = [
            "dataset_snapshots",
            "universe_snapshots",
            "dataset_price_bars",
            "dataset_corporate_actions",
            "dataset_symbol_coverage",
            "dataset_index_valuations",
            "dataset_index_valuation_coverage",
            "bond_fixed_income_snapshots",
            "universe_membership_snapshots",
            "pit_cleaning_runs",
            "pit_quality_events",
            "pit_research_waivers",
        ]
        with self.connect() as conn:
            return {
                table_name: int(conn.execute(f"SELECT COUNT(*) AS count FROM {table_name}").fetchone()["count"])
                for table_name in table_names
            }

    def list_pit_cleaning_runs(self, *, limit: int = 10) -> list[dict[str, Any]]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT *
                FROM pit_cleaning_runs
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (max(1, int(limit)),),
            ).fetchall()
        decoded: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["blocker"] = loads(item.pop("blocker_json", None), {})
            item["summary"] = loads(item.pop("summary_json", None), {})
            decoded.append(item)
        return decoded

    def list_pit_quality_events(
        self,
        *,
        dataset_snapshot_id: str | None = None,
        universe_snapshot_id: str | None = None,
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        sql = "SELECT * FROM pit_quality_events"
        filters: list[str] = []
        params: list[Any] = []
        if dataset_snapshot_id:
            filters.append("dataset_snapshot_id = ?")
            params.append(dataset_snapshot_id)
        if universe_snapshot_id:
            filters.append("universe_snapshot_id = ?")
            params.append(universe_snapshot_id)
        if filters:
            sql += " WHERE " + " AND ".join(filters)
        sql += " ORDER BY event_time DESC LIMIT ?"
        params.append(max(1, int(limit)))
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        events: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["metadata"] = loads(item.pop("metadata_json", None), {})
            events.append(item)
        return events

    def get_active_pit_research_waiver(
        self,
        *,
        dataset_snapshot_id: str,
        universe_snapshot_id: str,
    ) -> dict[str, Any] | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM pit_research_waivers
                WHERE dataset_snapshot_id = ?
                  AND universe_snapshot_id = ?
                  AND revoked_at IS NULL
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (dataset_snapshot_id, universe_snapshot_id),
            ).fetchone()
        if not row:
            return None
        item = dict(row)
        item["ignored_symbols"] = loads(item.pop("ignored_symbols_json", None), [])
        return item

    def upsert_pit_research_waiver(
        self,
        *,
        waiver_id: str,
        dataset_snapshot_id: str,
        universe_snapshot_id: str,
        ignored_symbols: Iterable[str],
        reason: str,
        created_by: str = "researcher",
    ) -> dict[str, Any]:
        now = iso_now()
        normalized_symbols = sorted(
            {
                self._normalize_symbol(str(symbol))
                for symbol in ignored_symbols
                if str(symbol or "").strip()
            }
        )
        with self.connect() as conn:
            conn.execute(
                """
                UPDATE pit_research_waivers
                SET revoked_at = ?
                WHERE dataset_snapshot_id = ?
                  AND universe_snapshot_id = ?
                  AND revoked_at IS NULL
                """,
                (now, dataset_snapshot_id, universe_snapshot_id),
            )
            conn.execute(
                """
                INSERT INTO pit_research_waivers (
                    id, dataset_snapshot_id, universe_snapshot_id, ignored_symbols_json,
                    reason, created_by, created_at, revoked_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
                """,
                (
                    waiver_id,
                    dataset_snapshot_id,
                    universe_snapshot_id,
                    dumps(normalized_symbols),
                    reason,
                    created_by,
                    now,
                ),
            )
        return {
            "id": waiver_id,
            "dataset_snapshot_id": dataset_snapshot_id,
            "universe_snapshot_id": universe_snapshot_id,
            "ignored_symbols": normalized_symbols,
            "reason": reason,
            "created_by": created_by,
            "created_at": now,
            "revoked_at": None,
        }

    def revoke_pit_research_waiver(self, waiver_id: str) -> bool:
        now = iso_now()
        with self.connect() as conn:
            cursor = conn.execute(
                """
                UPDATE pit_research_waivers
                SET revoked_at = ?
                WHERE id = ? AND revoked_at IS NULL
                """,
                (now, waiver_id),
            )
        return cursor.rowcount > 0

    def load_symbol_identity_rows(self, symbols: Iterable[str]) -> list[dict[str, Any]]:
        normalized_symbols = [self._normalize_symbol(str(symbol)) for symbol in symbols if str(symbol or "").strip()]
        if not normalized_symbols:
            return []
        with self.connect() as conn:
            rows = conn.execute(
                f"""
                SELECT *
                FROM symbol_identity_cache
                WHERE symbol IN ({','.join('?' for _ in normalized_symbols)})
                ORDER BY symbol
                """,
                normalized_symbols,
            ).fetchall()
        return [dict(row) for row in rows]

    def _decode_json_row(self, row: dict[str, Any], json_column: str) -> dict[str, Any]:
        payload = loads(row.pop(json_column, None), {})
        target_column = "metadata" if json_column == "metadata_json" else "payload"
        row[target_column] = payload
        return row

    def _decode_bond_fixed_income_snapshot_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        decoded = dict(row)
        missing_fields = loads(decoded.pop("missing_fields_json", None), [])
        inferred_fields = loads(decoded.pop("inferred_fields_json", None), {})
        raw_payload = loads(decoded.pop("raw_json", None), {})
        decoded["missing_fields"] = missing_fields if isinstance(missing_fields, list) else []
        decoded["inferred_fields"] = inferred_fields if isinstance(inferred_fields, Mapping) else {}
        decoded["raw"] = raw_payload if isinstance(raw_payload, Mapping) else {}
        return decoded

    def upsert_bond_fixed_income_snapshot(self, snapshot: Mapping[str, Any]) -> str:
        instrument_id = str(
            snapshot.get("instrument_id")
            or snapshot.get("id")
            or snapshot.get("symbol")
            or snapshot.get("isin")
            or snapshot.get("cusip")
            or ""
        ).strip()
        if not instrument_id:
            raise ValueError("instrument_id is required for bond fixed-income snapshots")
        snapshot_date = str(snapshot.get("snapshot_date") or snapshot.get("as_of") or "").strip()
        if not snapshot_date:
            raise ValueError("snapshot_date is required for bond fixed-income snapshots")
        source = str(snapshot.get("source") or snapshot.get("provider") or "manual").strip()
        snapshot_id = str(
            snapshot.get("id")
            or snapshot.get("source_snapshot_id")
            or f"bond_fixed_income::{instrument_id}::{snapshot_date}::{source}"
        ).strip()
        now = str(snapshot.get("updated_at") or iso_now())
        created_at = str(snapshot.get("created_at") or now)
        refreshed_at = snapshot.get("refreshed_at") or now
        missing_fields = snapshot.get("missing_fields")
        if missing_fields is None:
            missing_fields = snapshot.get("missing_fields_json")
        inferred_fields = snapshot.get("inferred_fields")
        if inferred_fields is None:
            inferred_fields = snapshot.get("inferred_fields_json")
        raw_payload = snapshot.get("raw")
        if raw_payload is None:
            raw_payload = snapshot.get("raw_json")
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO bond_fixed_income_snapshots (
                    id,
                    instrument_id,
                    symbol,
                    isin,
                    cusip,
                    name,
                    instrument_type,
                    currency,
                    snapshot_date,
                    maturity_date,
                    coupon_rate_pct,
                    clean_price,
                    net_price,
                    dirty_price,
                    full_price,
                    accrued_interest,
                    ytm_pct,
                    duration,
                    convexity,
                    source,
                    source_snapshot_id,
                    refresh_status,
                    missing_fields_json,
                    inferred_fields_json,
                    raw_json,
                    created_at,
                    updated_at,
                    refreshed_at,
                    deleted_at,
                    deleted_reason
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    instrument_id = excluded.instrument_id,
                    symbol = excluded.symbol,
                    isin = excluded.isin,
                    cusip = excluded.cusip,
                    name = excluded.name,
                    instrument_type = excluded.instrument_type,
                    currency = excluded.currency,
                    snapshot_date = excluded.snapshot_date,
                    maturity_date = excluded.maturity_date,
                    coupon_rate_pct = excluded.coupon_rate_pct,
                    clean_price = excluded.clean_price,
                    net_price = excluded.net_price,
                    dirty_price = excluded.dirty_price,
                    full_price = excluded.full_price,
                    accrued_interest = excluded.accrued_interest,
                    ytm_pct = excluded.ytm_pct,
                    duration = excluded.duration,
                    convexity = excluded.convexity,
                    source = excluded.source,
                    source_snapshot_id = excluded.source_snapshot_id,
                    refresh_status = excluded.refresh_status,
                    missing_fields_json = excluded.missing_fields_json,
                    inferred_fields_json = excluded.inferred_fields_json,
                    raw_json = excluded.raw_json,
                    updated_at = excluded.updated_at,
                    refreshed_at = excluded.refreshed_at,
                    deleted_at = excluded.deleted_at,
                    deleted_reason = excluded.deleted_reason
                """,
                (
                    snapshot_id,
                    instrument_id,
                    self._normalize_symbol(str(snapshot.get("symbol") or "")) if snapshot.get("symbol") else "",
                    snapshot.get("isin"),
                    snapshot.get("cusip"),
                    str(snapshot.get("name") or snapshot.get("label") or instrument_id),
                    str(snapshot.get("instrument_type") or "bond"),
                    str(snapshot.get("currency") or "USD").upper(),
                    snapshot_date,
                    snapshot.get("maturity_date"),
                    snapshot.get("coupon_rate_pct"),
                    snapshot.get("clean_price"),
                    snapshot.get("net_price"),
                    snapshot.get("dirty_price"),
                    snapshot.get("full_price"),
                    snapshot.get("accrued_interest"),
                    snapshot.get("ytm_pct"),
                    snapshot.get("duration"),
                    snapshot.get("convexity"),
                    source,
                    str(snapshot.get("source_snapshot_id") or snapshot_id),
                    str(snapshot.get("refresh_status") or "STALE").upper(),
                    dumps(missing_fields if isinstance(missing_fields, list) else []),
                    dumps(_ensure_json_dict(inferred_fields)),
                    dumps(_ensure_json_dict(raw_payload)),
                    created_at,
                    now,
                    refreshed_at,
                    snapshot.get("deleted_at"),
                    snapshot.get("deleted_reason"),
                ),
            )
        return snapshot_id

    def list_bond_fixed_income_snapshots(self, *, include_deleted: bool = False) -> list[dict[str, Any]]:
        sql = "SELECT * FROM bond_fixed_income_snapshots"
        if not include_deleted:
            sql += " WHERE deleted_at IS NULL"
        sql += " ORDER BY snapshot_date DESC, updated_at DESC, instrument_id ASC"
        with self.connect() as conn:
            rows = conn.execute(sql).fetchall()
        return [self._decode_bond_fixed_income_snapshot_row(row) for row in rows]

    def get_bond_fixed_income_snapshot(self, snapshot_ref: str) -> dict[str, Any] | None:
        normalized_ref = str(snapshot_ref or "").strip()
        if not normalized_ref:
            return None
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT *
                FROM bond_fixed_income_snapshots
                WHERE deleted_at IS NULL
                  AND (
                    id = ?
                    OR source_snapshot_id = ?
                    OR instrument_id = ?
                    OR symbol = ?
                    OR isin = ?
                    OR cusip = ?
                  )
                ORDER BY snapshot_date DESC, updated_at DESC
                LIMIT 1
                """,
                (
                    normalized_ref,
                    normalized_ref,
                    normalized_ref,
                    self._normalize_symbol(normalized_ref),
                    normalized_ref,
                    normalized_ref,
                ),
            ).fetchone()
        return self._decode_bond_fixed_income_snapshot_row(row) if row else None

    def load_bars(
        self,
        symbols: Iterable[str] | None = None,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        sql = "SELECT * FROM market_bars"
        filters: list[str] = []
        params: list[Any] = []
        normalized_symbols = [self._normalize_symbol(symbol) for symbol in (symbols or []) if symbol]
        if normalized_symbols:
            filters.append(f"symbol IN ({','.join('?' for _ in normalized_symbols)})")
            params.extend(normalized_symbols)
        if start_date:
            filters.append("date >= ?")
            params.append(start_date)
        if end_date:
            filters.append("date <= ?")
            params.append(end_date)
        if filters:
            sql += " WHERE " + " AND ".join(filters)
        sql += " ORDER BY symbol ASC, date ASC"
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            grouped.setdefault(row["symbol"], []).append(dict(row))
        return grouped

    def load_actions(
        self,
        symbols: Iterable[str] | None = None,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> list[dict[str, Any]]:
        sql = "SELECT * FROM market_actions"
        filters: list[str] = []
        params: list[Any] = []
        normalized_symbols = [self._normalize_symbol(symbol) for symbol in (symbols or []) if symbol]
        if normalized_symbols:
            filters.append(f"symbol IN ({','.join('?' for _ in normalized_symbols)})")
            params.extend(normalized_symbols)
        if start_date:
            filters.append("date >= ?")
            params.append(start_date)
        if end_date:
            filters.append("date <= ?")
            params.append(end_date)
        if filters:
            sql += " WHERE " + " AND ".join(filters)
        sql += " ORDER BY symbol ASC, date ASC, action_type ASC"
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._decode_json_row(dict(row), "payload_json") for row in rows]

    def load_trade_dates(self, benchmark_symbol: str | None = None) -> list[str]:
        sql = "SELECT DISTINCT date FROM market_bars"
        params: list[Any] = []
        if benchmark_symbol:
            sql += " WHERE symbol = ?"
            params.append(self._normalize_symbol(benchmark_symbol))
        sql += " ORDER BY date ASC"
        with self.connect() as conn:
            return [row["date"] for row in conn.execute(sql, params).fetchall()]

    def list_symbols(self) -> list[str]:
        with self.connect() as conn:
            return [row["symbol"] for row in conn.execute("SELECT DISTINCT symbol FROM market_bars ORDER BY symbol").fetchall()]

    def list_coverage(self) -> list[dict[str, Any]]:
        with self.connect() as conn:
            return [dict(row) for row in conn.execute("SELECT * FROM market_coverages ORDER BY symbol").fetchall()]

    def replace_symbol_identity_cache(self, identities: Iterable[Mapping[str, Any]]) -> None:
        rows = [self._normalize_identity_row(identity) for identity in identities]
        with self.connect() as conn:
            conn.execute("DELETE FROM symbol_identity_cache")
            if rows:
                conn.executemany(
                    """
                    INSERT INTO symbol_identity_cache (
                        symbol, canonical_symbol, company_name, cik, exchange,
                        ipo_date, delisting_date, source, valid_from, valid_to
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    rows,
                )

    def upsert_symbol_identity(self, identity: Mapping[str, Any]) -> None:
        row = self._normalize_identity_row(identity)
        with self.connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO symbol_identity_cache (
                    symbol, canonical_symbol, company_name, cik, exchange,
                    ipo_date, delisting_date, source, valid_from, valid_to
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                row,
            )

    def list_symbol_identity_cache(self, symbols: Iterable[str] | None = None) -> list[dict[str, Any]]:
        sql = "SELECT * FROM symbol_identity_cache"
        params: list[Any] = []
        normalized_symbols = [self._normalize_symbol(symbol) for symbol in (symbols or []) if symbol]
        if normalized_symbols:
            sql += f" WHERE symbol IN ({','.join('?' for _ in normalized_symbols)})"
            params.extend(normalized_symbols)
        sql += " ORDER BY symbol ASC"
        with self.connect() as conn:
            return [dict(row) for row in conn.execute(sql, params).fetchall()]

    def load_symbol_identity(self, symbol: str) -> dict[str, Any] | None:
        normalized_symbol = self._normalize_symbol(symbol)
        with self.connect() as conn:
            row = conn.execute(
                "SELECT * FROM symbol_identity_cache WHERE symbol = ?",
                (normalized_symbol,),
            ).fetchone()
        return dict(row) if row else None

    def _normalize_identity_row(self, identity: Mapping[str, Any]) -> tuple[Any, ...]:
        symbol = self._normalize_symbol(str(identity.get("symbol") or identity.get("canonical_symbol") or ""))
        canonical_symbol = self._normalize_symbol(str(identity.get("canonical_symbol") or symbol))
        return (
            symbol,
            canonical_symbol,
            str(identity.get("company_name") or identity.get("name") or ""),
            str(identity.get("cik") or ""),
            str(identity.get("exchange") or ""),
            identity.get("ipo_date"),
            identity.get("delisting_date"),
            str(identity.get("source") or ""),
            identity.get("valid_from"),
            identity.get("valid_to"),
        )

    def store_run_artifacts(
        self,
        run_id: str,
        *,
        daily_performance: Iterable[Mapping[str, Any]],
        trades: Iterable[Mapping[str, Any]],
    ) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO run_artifacts (run_id, daily_performance_json, trades_json)
                VALUES (?, ?, ?)
                """,
                (run_id, dumps(list(daily_performance)), dumps(list(trades))),
            )

    def load_run_daily_performance(self, run_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute("SELECT daily_performance_json FROM run_artifacts WHERE run_id = ?", (run_id,)).fetchone()
        return loads(row["daily_performance_json"], []) if row else []

    def count_run_trades(self, run_id: str) -> int:
        with self.connect() as conn:
            row = conn.execute("SELECT trades_json FROM run_artifacts WHERE run_id = ?", (run_id,)).fetchone()
        return len(loads(row["trades_json"], [])) if row else 0

    def list_run_trades(self, run_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            row = conn.execute("SELECT trades_json FROM run_artifacts WHERE run_id = ?", (run_id,)).fetchone()
        return loads(row["trades_json"], []) if row else []

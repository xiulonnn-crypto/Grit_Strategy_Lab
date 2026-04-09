from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping

from .storage import dumps, iso_now, loads


DATASET_PRICE_SNAPSHOT_ID = "ds-price"
DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID = "ds-corporate-actions"
DEFAULT_UNIVERSE_ANCHOR_SCHEDULE = "01-01,07-01"


@dataclass(slots=True)
class CoverageSummary:
    symbol: str
    start_date: str | None
    end_date: str | None
    trade_days: int


def _row_factory(cursor: sqlite3.Cursor, row: tuple[Any, ...]) -> dict[str, Any]:
    return {description[0]: row[index] for index, description in enumerate(cursor.description)}


def _normalize_symbol(value: str) -> str:
    return value.strip().upper()


def _ensure_json_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    return {}


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
        "CREATE INDEX IF NOT EXISTS idx_universe_membership_effective ON universe_membership_snapshots(effective_date, symbol)"
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
        conn = sqlite3.connect(self.path)
        conn.row_factory = _row_factory
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _normalize_symbol(self, value: str) -> str:
        return _normalize_symbol(value)

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
    ) -> str:
        dataset_snapshot_id = str(snapshot["id"])
        with self.connect() as conn:
            self._upsert_dataset_snapshot(conn, snapshot)
            conn.execute("DELETE FROM dataset_price_bars WHERE dataset_snapshot_id = ?", (dataset_snapshot_id,))
            conn.execute("DELETE FROM dataset_corporate_actions WHERE dataset_snapshot_id = ?", (dataset_snapshot_id,))
            conn.execute("DELETE FROM dataset_symbol_coverage WHERE dataset_snapshot_id = ?", (dataset_snapshot_id,))

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
        return dataset_snapshot_id

    def merge_dataset_snapshot(
        self,
        snapshot: Mapping[str, Any],
        *,
        price_bars: Iterable[Mapping[str, Any]] = (),
        corporate_actions: Iterable[Mapping[str, Any]] = (),
        symbol_coverage: Iterable[CoverageSummary | Mapping[str, Any]] = (),
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
        return {
            "price_bars": [self._decode_json_row(dict(row), "metadata_json") for row in price_rows],
            "corporate_actions": [self._decode_json_row(dict(row), "payload_json") for row in action_rows],
            "symbol_coverage": [self._decode_json_row(dict(row), "metadata_json") for row in coverage_rows],
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
        return {
            "price_bars": int((price_row or {}).get("count") or 0),
            "corporate_actions": int((action_row or {}).get("count") or 0),
            "symbol_coverage": int((coverage_row or {}).get("count") or 0),
        }

    def summarize_dataset_symbols(self, dataset_snapshot_id: str) -> list[dict[str, Any]]:
        with self.connect() as conn:
            price_rows = conn.execute(
                """
                SELECT
                    symbol,
                    MIN(date) AS start_date,
                    MAX(date) AS end_date,
                    COUNT(*) AS trade_days
                FROM dataset_price_bars
                WHERE dataset_snapshot_id = ?
                GROUP BY symbol
                ORDER BY symbol
                """,
                (dataset_snapshot_id,),
            ).fetchall()
            if price_rows:
                return [dict(row) for row in price_rows]

            action_rows = conn.execute(
                """
                SELECT
                    symbol,
                    MIN(event_date) AS start_date,
                    MAX(event_date) AS end_date,
                    COUNT(*) AS trade_days
                FROM dataset_corporate_actions
                WHERE dataset_snapshot_id = ?
                GROUP BY symbol
                ORDER BY symbol
                """,
                (dataset_snapshot_id,),
            ).fetchall()
        return [dict(row) for row in action_rows]

    def load_dataset_price_bars(
        self,
        dataset_snapshot_id: str,
        symbols: Iterable[str] | None = None,
        *,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> dict[str, list[dict[str, Any]]]:
        sql = "SELECT * FROM dataset_price_bars WHERE dataset_snapshot_id = ?"
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
            decoded = self._decode_json_row(dict(row), "metadata_json")
            grouped.setdefault(str(decoded["symbol"]), []).append(decoded)
        return grouped

    def load_universe_memberships(
        self,
        *,
        universe_snapshot_id: str | None = None,
        universe_key: str | None = None,
        effective_date: str | None = None,
    ) -> list[dict[str, Any]]:
        sql = """
            SELECT ums.*
            FROM universe_membership_snapshots ums
            JOIN universe_snapshots us ON us.id = ums.universe_snapshot_id
        """
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
        if filters:
            sql += " WHERE " + " AND ".join(filters)
        sql += " ORDER BY ums.effective_date ASC, ums.symbol ASC"
        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [self._decode_json_row(dict(row), "metadata_json") for row in rows]

    def snapshot_table_counts(self) -> dict[str, int]:
        table_names = [
            "dataset_snapshots",
            "universe_snapshots",
            "dataset_price_bars",
            "dataset_corporate_actions",
            "dataset_symbol_coverage",
            "universe_membership_snapshots",
        ]
        with self.connect() as conn:
            return {
                table_name: int(conn.execute(f"SELECT COUNT(*) AS count FROM {table_name}").fetchone()["count"])
                for table_name in table_names
            }

    def _decode_json_row(self, row: dict[str, Any], json_column: str) -> dict[str, Any]:
        payload = loads(row.pop(json_column, None), {})
        target_column = "metadata" if json_column == "metadata_json" else "payload"
        row[target_column] = payload
        return row

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

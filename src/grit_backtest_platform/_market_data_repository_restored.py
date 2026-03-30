from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Mapping

from .storage import dumps, loads


@dataclass(slots=True)
class CoverageSummary:
    symbol: str
    start_date: str | None
    end_date: str | None
    trade_days: int


def _row_factory(cursor: sqlite3.Cursor, row: tuple[Any, ...]) -> dict[str, Any]:
    return {description[0]: row[index] for index, description in enumerate(cursor.description)}


def initialize_market_data_schema(conn: sqlite3.Connection) -> None:
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
        CREATE TABLE IF NOT EXISTS run_artifacts (
            run_id TEXT PRIMARY KEY,
            daily_performance_json TEXT NOT NULL DEFAULT '[]',
            trades_json TEXT NOT NULL DEFAULT '[]'
        )
        """
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
        return conn

    def _normalize_symbol(self, value: str) -> str:
        return value.strip().upper()

    def replace_bars(self, symbol: str, bars: Iterable[Mapping[str, Any]]) -> None:
        rows = [
            (
                self._normalize_symbol(symbol),
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
            conn.execute("DELETE FROM market_bars WHERE symbol = ?", (self._normalize_symbol(symbol),))
            conn.executemany(
                """
                INSERT INTO market_bars (symbol, date, open, high, low, close, adj_close, volume)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )

    def replace_actions(self, symbol: str, actions: Iterable[Mapping[str, Any]]) -> None:
        rows = [
            (
                self._normalize_symbol(symbol),
                str(action["date"]),
                str(action.get("action_type") or action.get("type") or "unknown"),
                action.get("value"),
                dumps(dict(action)),
            )
            for action in actions
        ]
        with self.connect() as conn:
            conn.execute("DELETE FROM market_actions WHERE symbol = ?", (self._normalize_symbol(symbol),))
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
            if isinstance(coverage, Mapping):
                item = coverage
            else:
                item = {
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

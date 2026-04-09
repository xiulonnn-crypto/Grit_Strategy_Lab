from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import replace
from dataclasses import dataclass
from datetime import date
from typing import Any, Iterable

from .fallback_provider import ProviderAvailability


FMP_SP500_CURRENT_ENDPOINT = "https://financialmodelingprep.com/stable/sp500-constituent"
FMP_NASDAQ100_CURRENT_ENDPOINT = "https://financialmodelingprep.com/stable/nasdaq-constituent"
FMP_SP500_HISTORICAL_ENDPOINT = "https://financialmodelingprep.com/stable/historical-sp500-constituent"
FMP_NASDAQ100_HISTORICAL_ENDPOINT = "https://financialmodelingprep.com/stable/historical-nasdaq-constituent"

_CURRENT_ENDPOINTS = {
    "sp500": FMP_SP500_CURRENT_ENDPOINT,
    "nasdaq100": FMP_NASDAQ100_CURRENT_ENDPOINT,
}
_HISTORICAL_ENDPOINTS = {
    "sp500": (
        FMP_SP500_HISTORICAL_ENDPOINT,
        "https://financialmodelingprep.com/api/v3/historical/sp500_constituent",
    ),
    "nasdaq100": (
        FMP_NASDAQ100_HISTORICAL_ENDPOINT,
        "https://financialmodelingprep.com/api/v3/historical/nasdaq_constituent",
    ),
}


def _normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _parse_date(value: Any) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _pick_first(row: dict[str, Any], keys: Iterable[str]) -> Any:
    for key in keys:
        if key in row and row.get(key) not in {None, ""}:
            return row.get(key)
    return None


def _coerce_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [dict(item) for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("historical", "data", "results", "constituents", "changes"):
            value = payload.get(key)
            if isinstance(value, list):
                return [dict(item) for item in value if isinstance(item, dict)]
    return []


@dataclass(frozen=True)
class FmpConstituentMembership:
    symbol: str
    added_date: date | None
    removed_date: date | None


@dataclass(frozen=True)
class FmpConstituentChange:
    effective_date: date
    additions: tuple[str, ...] = ()
    deletions: tuple[str, ...] = ()


class FmpHistoricalConstituentProvider:
    provider_name = "fmp_historical_constituent"

    def __init__(self, *, universe_key: str, display_name: str, api_key: str | None = None, timeout: int = 20) -> None:
        self.universe_key = universe_key
        self.display_name = display_name
        self.api_key = str(api_key or os.getenv("FMP_API_KEY") or "").strip()
        self.timeout = timeout
        self._memberships: list[FmpConstituentMembership] | None = None

    def availability(self) -> ProviderAvailability:
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=bool(self.api_key),
            reason=None if self.api_key else "FMP_API_KEY is not configured.",
            metadata={"universe_key": self.universe_key},
        )

    def _request_json(self, url: str) -> Any:
        if not self.api_key:
            raise RuntimeError("FMP_API_KEY is not configured.")
        query = urllib.parse.urlencode({"apikey": self.api_key})
        request = urllib.request.Request(f"{url}?{query}", headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            if exc.code in {402, 429}:
                raise RuntimeError(f"FMP historical constituent API unavailable ({exc.code}).") from exc
            raise RuntimeError(f"FMP historical constituent request failed ({exc.code}).") from exc
        except (urllib.error.URLError, TimeoutError, ValueError) as exc:
            raise RuntimeError(f"FMP historical constituent request failed: {exc}") from exc

    def _request_payload(self) -> Any:
        last_error: Exception | None = None
        for endpoint in _HISTORICAL_ENDPOINTS[self.universe_key]:
            try:
                return self._request_json(endpoint)
            except RuntimeError as exc:
                last_error = exc
                if "(402)" in str(exc) or "(429)" in str(exc):
                    raise
        raise RuntimeError(f"FMP historical constituent request failed: {last_error}") from last_error

    def _parse_memberships(self, payload: Any) -> list[FmpConstituentMembership]:
        memberships: list[FmpConstituentMembership] = []
        for item in _coerce_rows(payload):
            symbol = _normalize_symbol(
                _pick_first(
                    item,
                    (
                        "symbol",
                        "ticker",
                        "addedTicker",
                        "added_ticker",
                        "constituent",
                    ),
                )
            )
            if not symbol:
                continue
            added_date = _parse_date(
                _pick_first(
                    item,
                    (
                        "dateAdded",
                        "date_added",
                        "addedDate",
                        "added_date",
                        "dateFirstAdded",
                        "date_first_added",
                        "joinedDate",
                        "joined_date",
                    ),
                )
            )
            removed_date = _parse_date(
                _pick_first(
                    item,
                    (
                        "dateRemoved",
                        "date_removed",
                        "removedDate",
                        "removed_date",
                        "deletedDate",
                        "deleted_date",
                    ),
                )
            )
            if added_date is None and removed_date is None:
                continue
            memberships.append(
                FmpConstituentMembership(
                    symbol=symbol,
                    added_date=added_date,
                    removed_date=removed_date,
                )
            )
        if not memberships:
            raise RuntimeError("FMP historical constituent payload did not expose membership intervals.")
        return memberships

    def _load_memberships(self) -> list[FmpConstituentMembership]:
        if self._memberships is None:
            self._memberships = self._parse_memberships(self._request_payload())
        return self._memberships

    def load_anchor_symbols(self, anchor: date) -> list[str]:
        members = []
        for membership in self._load_memberships():
            if membership.added_date and membership.added_date > anchor:
                continue
            if membership.removed_date and membership.removed_date <= anchor:
                continue
            members.append(membership.symbol)
        ordered = sorted(dict.fromkeys(members))
        if not ordered:
            raise RuntimeError(
                f"FMP historical constituent provider returned no members for {self.display_name} at {anchor.isoformat()}."
            )
        return ordered


class FmpHistoricalConstituentUniverseHistoryProvider:
    provider_name = "fmp_historical_constituent"

    def __init__(
        self,
        *,
        definition: Any,
        fallback_provider: Any,
        api_key: str | None = None,
        timeout: int = 20,
    ) -> None:
        self.definition = definition
        self.fallback_provider = fallback_provider
        self.api_key = str(api_key or os.getenv("FMP_API_KEY") or "").strip()
        self.timeout = timeout
        self._interval_provider = FmpHistoricalConstituentProvider(
            universe_key=str(definition.universe_key),
            display_name=str(definition.display_name),
            api_key=self.api_key,
            timeout=timeout,
        )

    def availability(self) -> ProviderAvailability:
        return self._interval_provider.availability()

    def _probe_metadata_for_error(self, error: Exception | None = None) -> dict[str, Any]:
        detail = str(error or "").strip()
        detail_lower = detail.lower()
        if not self.api_key:
            status = "unconfigured"
            detail = detail or "FMP_API_KEY is not configured."
        elif "(429)" in detail or " 429" in detail or "rate limit" in detail_lower:
            status = "rate_limited"
        elif "(402)" in detail or " 402" in detail or "payment required" in detail_lower:
            status = "capability_unavailable"
        elif "did not expose" in detail_lower or "returned no members" in detail_lower:
            status = "malformed_payload"
        else:
            status = "request_failed"
        return {
            "historical_constituent_provider": "fmp",
            "historical_constituent_probe_status": status,
            "historical_constituent_probe_error": detail,
        }

    def _fallback_snapshots(
        self,
        start_date: date,
        end_date: date,
        *,
        error: Exception | None = None,
    ) -> list[Any]:
        probe_metadata = self._probe_metadata_for_error(error)
        fallback_snapshots = self.fallback_provider.load_snapshots(start_date, end_date)
        wrapped: list[Any] = []
        for snapshot in fallback_snapshots:
            metadata = dict(getattr(snapshot, "metadata", {}) or {})
            metadata.update(probe_metadata)
            wrapped.append(replace(snapshot, metadata=metadata))
        return wrapped

    def _request_json(self, url: str) -> Any:
        return self._interval_provider._request_json(url)

    def _request_historical_payload(self) -> Any:
        last_error: Exception | None = None
        for endpoint in _HISTORICAL_ENDPOINTS[str(self.definition.universe_key)]:
            try:
                return self._request_json(endpoint)
            except RuntimeError as exc:
                last_error = exc
                if "(402)" in str(exc) or "(429)" in str(exc):
                    raise
        raise RuntimeError(f"FMP historical constituent request failed: {last_error}") from last_error

    def _load_current_symbols(self) -> list[str]:
        rows = _coerce_rows(self._request_json(_CURRENT_ENDPOINTS[str(self.definition.universe_key)]))
        symbols = sorted(
            {
                _normalize_symbol(_pick_first(item, ("symbol", "ticker", "code")))
                for item in rows
            }
            - {""}
        )
        if not symbols:
            raise RuntimeError("FMP current constituent payload did not expose any symbols.")
        return symbols

    def _load_change_events(self) -> list[FmpConstituentChange]:
        rows = _coerce_rows(self._request_historical_payload())
        changes: list[FmpConstituentChange] = []
        for item in rows:
            effective_date = _parse_date(
                _pick_first(item, ("date", "effectiveDate", "effective_date", "changeDate", "change_date"))
            )
            if effective_date is None:
                continue
            additions: list[str] = []
            deletions: list[str] = []

            action = str(item.get("action") or item.get("type") or "").strip().lower()
            direct_symbol = _normalize_symbol(_pick_first(item, ("symbol", "ticker", "constituent")))
            if direct_symbol and action in {"addition", "add", "added"}:
                additions.append(direct_symbol)
            if direct_symbol and action in {"deletion", "delete", "deleted", "removal", "remove", "removed"}:
                deletions.append(direct_symbol)

            addition_symbol = _normalize_symbol(
                _pick_first(item, ("addedTicker", "added_ticker", "addedSymbol", "added_symbol"))
            )
            if addition_symbol:
                additions.append(addition_symbol)

            deletion_symbol = _normalize_symbol(
                _pick_first(item, ("removedTicker", "removed_ticker", "deletedSymbol", "deleted_symbol"))
            )
            if deletion_symbol:
                deletions.append(deletion_symbol)

            if not additions and not deletions:
                continue
            changes.append(
                FmpConstituentChange(
                    effective_date=effective_date,
                    additions=tuple(dict.fromkeys(symbol for symbol in additions if symbol)),
                    deletions=tuple(dict.fromkeys(symbol for symbol in deletions if symbol)),
                )
            )
        return sorted(changes, key=lambda item: item.effective_date, reverse=True)

    def _snapshot_from_symbols(
        self,
        *,
        anchor: date,
        symbols: list[str],
        current_count: int | None = None,
        change_count: int | None = None,
        mode: str,
    ) -> Any:
        from .universe_history import _snapshot_from_symbol_list

        metadata = {
            "historical_constituent_provider": "fmp",
            "historical_constituent_probe_status": "available",
            "source_quality_breakdown": {"historical_constituent_api": 1},
            "historical_constituent_mode": mode,
        }
        if current_count is not None:
            metadata["historical_constituent_current_count"] = current_count
        if change_count is not None:
            metadata["historical_constituent_change_count"] = change_count
        return _snapshot_from_symbol_list(
            definition=self.definition,
            anchor=anchor,
            source=self.provider_name,
            symbols=list(symbols),
            source_quality="historical_constituent_api",
            extra_metadata=metadata,
            source_revision_id=f"{self.provider_name}-{anchor.isoformat()}",
            source_page_title=self.definition.source_page_title,
        )

    def _load_interval_snapshots(self, anchors: list[date]) -> list[Any]:
        self._interval_provider._memberships = self._interval_provider._parse_memberships(self._request_historical_payload())
        snapshots = [
            self._snapshot_from_symbols(
                anchor=anchor,
                symbols=self._interval_provider.load_anchor_symbols(anchor),
                mode="interval_memberships",
            )
            for anchor in anchors
        ]
        if not snapshots:
            raise RuntimeError("FMP interval membership path returned no anchor snapshots.")
        return snapshots

    def _load_change_snapshots(self, anchors: list[date]) -> list[Any]:
        current_symbols = set(self._load_current_symbols())
        change_events = self._load_change_events()
        if not current_symbols:
            raise RuntimeError("FMP current constituent payload did not expose any symbols.")
        state = set(current_symbols)
        pending = list(change_events)
        snapshots_by_anchor: dict[date, list[str]] = {}
        for anchor in sorted(anchors, reverse=True):
            while pending and pending[0].effective_date > anchor:
                event = pending.pop(0)
                for symbol in event.additions:
                    state.discard(symbol)
                for symbol in event.deletions:
                    state.add(symbol)
            ordered = sorted(dict.fromkeys(symbol for symbol in state if symbol))
            if not ordered:
                raise RuntimeError(
                    f"FMP historical constituent event reconstruction returned no members for {self.definition.display_name} at {anchor.isoformat()}."
                )
            snapshots_by_anchor[anchor] = ordered
        return [
            self._snapshot_from_symbols(
                anchor=anchor,
                symbols=snapshots_by_anchor[anchor],
                current_count=len(current_symbols),
                change_count=len(change_events),
                mode="current_plus_changes",
            )
            for anchor in sorted(anchors)
        ]

    def load_snapshots(self, start_date: date, end_date: date) -> list[Any]:
        from .universe_history import semiannual_anchor_dates

        anchors = semiannual_anchor_dates(start_date, end_date)
        if not anchors:
            return []
        if not self.api_key:
            return self._fallback_snapshots(start_date, end_date)
        try:
            return self._load_interval_snapshots(anchors)
        except Exception as interval_error:
            try:
                return self._load_change_snapshots(anchors)
            except Exception as change_error:
                preferred_error = change_error if str(change_error).strip() else interval_error
                return self._fallback_snapshots(start_date, end_date, error=preferred_error)

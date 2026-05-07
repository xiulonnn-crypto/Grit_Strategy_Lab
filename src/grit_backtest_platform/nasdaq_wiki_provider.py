from __future__ import annotations

import hashlib
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from .backtest_engine import MarketBar
from .fallback_provider import ProviderAvailability, ProviderExecutionSignal
from .yahoo_provider import SymbolMarketData


NASDAQ_DATA_LINK_DATASET_ENDPOINT = "https://data.nasdaq.com/api/v3/datasets/{dataset_code}.json"
NASDAQ_DATA_LINK_TABLE_ENDPOINT = "https://data.nasdaq.com/api/v3/datatables/{datatable_code}.json"
DEFAULT_PRICE_TABLE_CODES = ("QUOTEMEDIA/PRICES",)


def _default_cache_dir() -> Path:
    return Path(__file__).resolve().parents[2] / ".tmp" / "pit-bulk-cache" / "nasdaq-data-link" / "wiki"


def _configured_cache_dir(explicit_cache_dir: str | Path | None = None) -> Path:
    configured = str(explicit_cache_dir or os.getenv("GRIT_NASDAQ_WIKI_CACHE_DIR") or "").strip()
    return Path(configured).expanduser() if configured else _default_cache_dir()


def _configured_price_table_codes() -> tuple[str, ...]:
    raw = str(os.getenv("GRIT_NASDAQ_DATA_LINK_PRICE_TABLES") or "").strip()
    if not raw:
        return DEFAULT_PRICE_TABLE_CODES
    values = tuple(
        item.strip().upper()
        for item in raw.replace(";", ",").split(",")
        if item.strip()
    )
    return values or DEFAULT_PRICE_TABLE_CODES


def _normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper()


def _normalize_api_key(value: Any) -> str:
    text = str(value or "").strip()
    if text.lower().startswith("bearer "):
        text = text[7:].strip()
    if len(text) >= 2 and text[0] == text[-1] and text[0] in {"'", '"'}:
        text = text[1:-1].strip()
    return text


def _wiki_dataset_symbol(symbol: str) -> str:
    return _normalize_symbol(symbol).replace(".", "_").replace("-", "_")


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _normalize_date(value: Any) -> str:
    text = str(value or "").strip()
    return text[:10] if text else ""


class NasdaqWikiPriceProvider:
    provider_name = "nasdaq_wiki"

    def __init__(
        self,
        api_key: str | None = None,
        *,
        timeout: int = 30,
        cache_dir: str | Path | None = None,
    ) -> None:
        self.api_key = _normalize_api_key(api_key or os.getenv("NASDAQ_DATA_LINK_API_KEY") or "")
        self.timeout = int(timeout)
        self.cache_dir = _configured_cache_dir(cache_dir)
        self.price_table_codes = _configured_price_table_codes()
        self.metadata = {
            "access_tier": "free_account",
            "required_env_vars": ["NASDAQ_DATA_LINK_API_KEY"],
            "provider": self.provider_name,
            "database": "WIKI",
            "table_fallbacks": list(self.price_table_codes),
            "price_only": True,
        }

    def availability(self) -> ProviderAvailability:
        if not self.api_key:
            return ProviderAvailability(
                provider_name=self.provider_name,
                available=False,
                reason="NASDAQ_DATA_LINK_API_KEY is not configured.",
                metadata={**self.metadata, "credential_status": "missing"},
            )
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=True,
            metadata={**self.metadata, "credential_status": "present"},
        )

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> SymbolMarketData:
        normalized_symbol = _normalize_symbol(symbol)
        if not normalized_symbol:
            raise ValueError("Nasdaq WIKI fetch_history requires a symbol.")
        if end_date < start_date:
            raise ValueError("Nasdaq WIKI fetch_history requires end_date >= start_date.")

        provider_symbol = _wiki_dataset_symbol(normalized_symbol)
        failures: list[ProviderExecutionSignal] = []
        try:
            payload = self._request_dataset(provider_symbol, start_date, end_date)
            bars, skipped_rows = self._parse_dataset_payload(payload, start_date=start_date, end_date=end_date)
            if bars:
                warnings = []
                if skipped_rows:
                    warnings.append("Skipped Nasdaq WIKI rows because required price fields were incomplete.")
                return self._market_data_payload(
                    normalized_symbol=normalized_symbol,
                    provider_symbol=provider_symbol,
                    bars=bars,
                    warnings=warnings,
                    data_product="WIKI",
                )
            failures.append(
                ProviderExecutionSignal(
                    f"Nasdaq WIKI returned no usable historical price rows for {normalized_symbol}.",
                    status="failed",
                    reason="empty_response",
                    metadata={"provider_symbol": provider_symbol, "error_class": "empty_response", "data_product": "WIKI"},
                )
            )
        except ProviderExecutionSignal as exc:
            if exc.status == "limited" or exc.reason == "transient_request_failure":
                raise
            if exc.reason == "credential_rejected":
                raise
            failures.append(exc)

        for table_code in self.price_table_codes:
            for table_symbol in self._table_symbol_candidates(normalized_symbol, provider_symbol):
                try:
                    table_payload = self._request_table(table_code, table_symbol, start_date, end_date)
                    bars, skipped_rows = self._parse_table_payload(
                        table_payload,
                        start_date=start_date,
                        end_date=end_date,
                    )
                    if not bars:
                        continue
                    warnings = [
                        f"Nasdaq Data Link {table_code} table fallback used after WIKI returned no usable rows."
                    ]
                    if skipped_rows:
                        warnings.append("Skipped Nasdaq table rows because required price fields were incomplete.")
                    return self._market_data_payload(
                        normalized_symbol=normalized_symbol,
                        provider_symbol=table_symbol,
                        bars=bars,
                        warnings=warnings,
                        data_product=table_code,
                    )
                except ProviderExecutionSignal as exc:
                    if exc.status == "limited" or exc.reason == "transient_request_failure":
                        raise
                    failures.append(exc)
                    if exc.reason == "credential_rejected":
                        break

        if failures:
            terminal = failures[-1]
            metadata = dict(terminal.metadata or {})
            metadata["fallback_attempt_count"] = len(failures)
            raise ProviderExecutionSignal(
                f"Nasdaq Data Link returned no usable historical price rows for {normalized_symbol}.",
                status=terminal.status,
                reason=terminal.reason,
                metadata=metadata,
            ) from terminal
        raise ProviderExecutionSignal(
            f"Nasdaq Data Link returned no usable historical price rows for {normalized_symbol}.",
            status="failed",
            reason="empty_response",
            metadata={"provider_symbol": provider_symbol, "error_class": "empty_response"},
        )

    def _market_data_payload(
        self,
        *,
        normalized_symbol: str,
        provider_symbol: str,
        bars: list[MarketBar],
        warnings: list[str],
        data_product: str,
    ) -> SymbolMarketData:
        return SymbolMarketData(
            symbol=normalized_symbol,
            bars=bars,
            actions=[],
            source=self.provider_name,
            partial=bool(warnings),
            warnings=warnings,
            metadata={
                "provider": self.provider_name,
                "provider_symbol": provider_symbol,
                "database": "WIKI",
                "data_product": data_product,
                "bar_count": len(bars),
                "actions_supported": False,
                "price_only": True,
                "wiki_stopped_updating_after": "2018-03-27",
            },
        )

    def _request_dataset(self, provider_symbol: str, start_date: date, end_date: date) -> dict[str, Any]:
        cached = self._read_cache(f"wiki-{provider_symbol}", start_date, end_date)
        if cached is not None:
            return cached
        payload = self._request_json(
            f"WIKI/{provider_symbol}",
            {
                "start_date": start_date.isoformat(),
                "end_date": end_date.isoformat(),
                "order": "asc",
            },
            provider_symbol=provider_symbol,
        )
        self._write_cache(f"wiki-{provider_symbol}", start_date, end_date, payload)
        return payload

    def _request_table(self, table_code: str, table_symbol: str, start_date: date, end_date: date) -> dict[str, Any]:
        cache_key = f"table-{table_code.replace('/', '_')}-{table_symbol}"
        cached = self._read_cache(cache_key, start_date, end_date)
        if cached is not None:
            return cached
        payload = self._request_table_json(
            table_code,
            {
                "ticker": table_symbol,
                "date.gte": start_date.isoformat(),
                "date.lte": end_date.isoformat(),
                "qopts.per_page": 10000,
            },
            provider_symbol=table_symbol,
        )
        self._write_cache(cache_key, start_date, end_date, payload)
        return payload

    def _request_json(self, dataset_code: str, params: dict[str, Any], *, provider_symbol: str) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("NASDAQ_DATA_LINK_API_KEY is not configured.")
        encoded_dataset_code = urllib.parse.quote(dataset_code, safe="/")
        base_url = NASDAQ_DATA_LINK_DATASET_ENDPOINT.format(dataset_code=encoded_dataset_code)
        payload = self._request_text_from_url_with_auth_fallback(base_url, params, provider_symbol=provider_symbol)
        data = self._decode_json_payload(payload, provider_symbol=provider_symbol)
        self._raise_payload_signal(data, provider_symbol=provider_symbol)
        return data

    def _request_table_json(self, table_code: str, params: dict[str, Any], *, provider_symbol: str) -> dict[str, Any]:
        if not self.api_key:
            raise RuntimeError("NASDAQ_DATA_LINK_API_KEY is not configured.")
        encoded_table_code = urllib.parse.quote(table_code, safe="/")
        base_url = NASDAQ_DATA_LINK_TABLE_ENDPOINT.format(datatable_code=encoded_table_code)
        payload = self._request_text_from_url_with_auth_fallback(base_url, params, provider_symbol=provider_symbol)
        data = self._decode_json_payload(payload, provider_symbol=provider_symbol)
        self._raise_payload_signal(data, provider_symbol=provider_symbol)
        return data

    def _decode_json_payload(self, payload: str, *, provider_symbol: str) -> dict[str, Any]:
        try:
            data = json.loads(payload)
        except json.JSONDecodeError as exc:
            raise ProviderExecutionSignal(
                f"Nasdaq WIKI returned malformed JSON for {provider_symbol}.",
                status="failed",
                reason="malformed_payload",
                metadata={"provider_symbol": provider_symbol, "error_class": "malformed_payload"},
            ) from exc
        if not isinstance(data, dict):
            raise ProviderExecutionSignal(
                f"Unexpected Nasdaq WIKI payload type for {provider_symbol}.",
                status="failed",
                reason="unexpected_payload",
                metadata={"provider_symbol": provider_symbol, "error_class": "unexpected_payload"},
            )
        return data

    def _request_text_from_url_with_auth_fallback(
        self,
        base_url: str,
        params: dict[str, Any],
        *,
        provider_symbol: str,
    ) -> str:
        query_params = dict(params)
        query_params["api_key"] = self.api_key
        query_url = base_url + "?" + urllib.parse.urlencode(query_params)
        header_url = base_url + "?" + urllib.parse.urlencode(dict(params))
        requests = [
            urllib.request.Request(query_url, headers={"Accept": "application/json"}),
            urllib.request.Request(header_url, headers={"Accept": "application/json", "X-Api-Token": self.api_key}),
        ]
        last_http_error: urllib.error.HTTPError | None = None
        for index, request in enumerate(requests):
            try:
                with urllib.request.urlopen(request, timeout=self.timeout) as response:
                    return response.read().decode("utf-8")
            except urllib.error.HTTPError as exc:
                last_http_error = exc
                status_code = int(getattr(exc, "code", 0) or 0)
                if status_code in {401, 403} and index < len(requests) - 1:
                    continue
                self._raise_http_signal(exc, provider_symbol=provider_symbol)
            except (urllib.error.URLError, TimeoutError) as exc:
                raise ProviderExecutionSignal(
                    f"Nasdaq Data Link request failed for {provider_symbol}.",
                    status="failed",
                    reason="transient_request_failure",
                    metadata={"provider_symbol": provider_symbol, "error_class": type(exc).__name__},
                ) from exc
        if last_http_error is not None:
            self._raise_http_signal(last_http_error, provider_symbol=provider_symbol)
        raise ProviderExecutionSignal(
            f"Nasdaq Data Link request failed for {provider_symbol}.",
            status="failed",
            reason="unexpected_auth_failure",
            metadata={"provider_symbol": provider_symbol, "error_class": "unexpected_auth_failure"},
        )

    def _raise_payload_signal(self, data: dict[str, Any], *, provider_symbol: str) -> None:
        error_payload = data.get("quandl_error") or data.get("error")
        if not error_payload:
            return
        if isinstance(error_payload, dict):
            message = str(error_payload.get("message") or error_payload.get("code") or "").strip()
        else:
            message = str(error_payload or "").strip()
        reason = self._classify_auth_failure(message, status_code=403)
        raise ProviderExecutionSignal(
            f"Nasdaq Data Link returned an error for {provider_symbol}.",
            status="failed",
            reason=reason,
            metadata={
                "provider_symbol": provider_symbol,
                "error_class": reason,
                "provider_error_fingerprint": self._error_fingerprint(json.dumps(data, ensure_ascii=False)),
            },
        )

    def _raise_http_signal(self, exc: urllib.error.HTTPError, *, provider_symbol: str) -> None:
        status_code = int(getattr(exc, "code", 0) or 0)
        retry_after = str(getattr(exc, "headers", {}).get("Retry-After") or "").strip()
        error_body = self._read_http_error_body(exc)
        if status_code in {401, 403}:
            reason = self._classify_auth_failure(error_body, status_code=status_code)
        elif status_code == 404:
            reason = "symbol_invalid"
        elif status_code == 429:
            reason = "rate_limited"
        else:
            reason = "http_error"
        metadata: dict[str, Any] = {
            "provider_symbol": provider_symbol,
            "error_class": reason,
            "status_code": status_code,
        }
        if retry_after:
            metadata["retry_after"] = retry_after
            metadata["next_retry_at"] = self._retry_after_to_utc(retry_after)
        if error_body:
            metadata["provider_error_fingerprint"] = self._error_fingerprint(error_body)
        if status_code == 429:
            metadata["quota_limited"] = True
            metadata.setdefault("next_retry_at", self._next_hour_retry_at())
        raise ProviderExecutionSignal(
            f"Nasdaq Data Link request failed for {provider_symbol} with HTTP {status_code}.",
            status="limited" if status_code == 429 else "failed",
            reason=reason,
            metadata=metadata,
        )

    def _read_http_error_body(self, exc: urllib.error.HTTPError) -> str:
        try:
            body = exc.read()
        except Exception:
            return ""
        if not body:
            return ""
        try:
            return body.decode("utf-8", errors="replace")
        except Exception:
            return str(body)

    def _classify_auth_failure(self, error_body: str, *, status_code: int | None = None) -> str:
        body = error_body.lower()
        if any(
            term in body
            for term in (
                "not authorized",
                "not subscribed",
                "do not have access",
                "no access",
                "forbidden",
                "permission",
                "premium",
                "subscription",
            )
        ):
            return "entitlement_required"
        if any(term in body for term in ("invalid api", "incorrect api", "api key is invalid", "invalid key", "unrecognized api")):
            return "credential_rejected"
        if status_code == 403:
            return "entitlement_required"
        return "credential_rejected"

    def _error_fingerprint(self, error_body: str) -> str:
        try:
            payload = json.loads(error_body)
        except Exception:
            return "http_error_body"
        if isinstance(payload, dict):
            quandl_error = payload.get("quandl_error")
            if isinstance(quandl_error, dict):
                code = str(quandl_error.get("code") or "").strip()
                if code:
                    return code
        return "http_error_body"

    def _table_symbol_candidates(self, normalized_symbol: str, provider_symbol: str) -> list[str]:
        candidates = [
            normalized_symbol,
            normalized_symbol.replace("-", "."),
            normalized_symbol.replace("-", "_"),
            normalized_symbol.replace(".", "-"),
            normalized_symbol.replace(".", "_"),
            provider_symbol,
        ]
        return list(dict.fromkeys(item for item in candidates if item))

    def _parse_dataset_payload(
        self,
        payload: dict[str, Any],
        *,
        start_date: date,
        end_date: date,
    ) -> tuple[list[MarketBar], int]:
        dataset = payload.get("dataset_data") or payload.get("dataset") or {}
        if not isinstance(dataset, dict):
            dataset = {}
        columns = [str(item).strip() for item in (dataset.get("column_names") or dataset.get("columns") or [])]
        rows = dataset.get("data") or []
        column_index = {name.lower(): index for index, name in enumerate(columns)}

        bars: list[MarketBar] = []
        skipped_rows = 0
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, list):
                skipped_rows += 1
                continue
            values = {
                key: row[index] if index < len(row) else None
                for key, index in column_index.items()
            }
            trade_date = _normalize_date(values.get("date"))
            if not trade_date or trade_date < start_date.isoformat() or trade_date > end_date.isoformat():
                continue
            open_value = _safe_float(values.get("adj. open") if values.get("adj. open") is not None else values.get("open"))
            high_value = _safe_float(values.get("adj. high") if values.get("adj. high") is not None else values.get("high"))
            low_value = _safe_float(values.get("adj. low") if values.get("adj. low") is not None else values.get("low"))
            close_value = _safe_float(values.get("close"))
            adj_close_value = _safe_float(
                values.get("adj. close") if values.get("adj. close") is not None else values.get("close")
            )
            volume_value = _safe_float(
                values.get("adj. volume") if values.get("adj. volume") is not None else values.get("volume")
            )
            if None in {open_value, high_value, low_value, close_value, adj_close_value}:
                skipped_rows += 1
                continue
            bars.append(
                MarketBar(
                    date=trade_date,
                    open=float(open_value),
                    high=float(high_value),
                    low=float(low_value),
                    close=float(close_value),
                    adj_close=float(adj_close_value),
                    volume=float(volume_value or 0.0),
                )
            )
        bars.sort(key=lambda item: item.date)
        return bars, skipped_rows

    def _parse_table_payload(
        self,
        payload: dict[str, Any],
        *,
        start_date: date,
        end_date: date,
    ) -> tuple[list[MarketBar], int]:
        datatable = payload.get("datatable") or {}
        if not isinstance(datatable, dict):
            datatable = {}
        columns_raw = datatable.get("columns") or []
        columns: list[str] = []
        for item in columns_raw if isinstance(columns_raw, list) else []:
            if isinstance(item, dict):
                columns.append(str(item.get("name") or "").strip())
            else:
                columns.append(str(item or "").strip())
        rows = datatable.get("data") or []
        column_index = {name.lower().replace(" ", "_"): index for index, name in enumerate(columns)}

        def _value(values: dict[str, Any], aliases: tuple[str, ...]) -> Any:
            for alias in aliases:
                normalized_alias = alias.lower().replace(" ", "_")
                if normalized_alias in values and values.get(normalized_alias) is not None:
                    return values.get(normalized_alias)
            return None

        bars: list[MarketBar] = []
        skipped_rows = 0
        for row in rows if isinstance(rows, list) else []:
            if not isinstance(row, list):
                skipped_rows += 1
                continue
            values = {
                key: row[index] if index < len(row) else None
                for key, index in column_index.items()
            }
            trade_date = _normalize_date(_value(values, ("date", "trade_date", "price_date", "pricedate")))
            if not trade_date or trade_date < start_date.isoformat() or trade_date > end_date.isoformat():
                continue
            open_value = _safe_float(_value(values, ("adj_open", "adj. open", "adjopen", "open")))
            high_value = _safe_float(_value(values, ("adj_high", "adj. high", "adjhigh", "high")))
            low_value = _safe_float(_value(values, ("adj_low", "adj. low", "adjlow", "low")))
            close_value = _safe_float(_value(values, ("close", "last", "price")))
            adj_close_value = _safe_float(_value(values, ("adj_close", "adj. close", "adjclose", "adjusted_close", "close")))
            volume_value = _safe_float(_value(values, ("adj_volume", "adj. volume", "adjvolume", "volume")))
            if None in {open_value, high_value, low_value, close_value, adj_close_value}:
                skipped_rows += 1
                continue
            bars.append(
                MarketBar(
                    date=trade_date,
                    open=float(open_value),
                    high=float(high_value),
                    low=float(low_value),
                    close=float(close_value),
                    adj_close=float(adj_close_value),
                    volume=float(volume_value or 0.0),
                )
            )
        bars.sort(key=lambda item: item.date)
        return bars, skipped_rows

    def _cache_path(self, provider_symbol: str, start_date: date, end_date: date) -> Path:
        digest = hashlib.sha256(
            f"{provider_symbol}:{start_date.isoformat()}:{end_date.isoformat()}".encode("utf-8")
        ).hexdigest()[:16]
        return self.cache_dir / f"{provider_symbol}-{digest}.json"

    def _read_cache(self, provider_symbol: str, start_date: date, end_date: date) -> dict[str, Any] | None:
        path = self._cache_path(provider_symbol, start_date, end_date)
        if not path.is_file():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return None
        data = payload.get("payload") if isinstance(payload, dict) else None
        return data if isinstance(data, dict) else None

    def _write_cache(self, provider_symbol: str, start_date: date, end_date: date, payload: dict[str, Any]) -> None:
        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            self._cache_path(provider_symbol, start_date, end_date).write_text(
                json.dumps(
                    {
                        "provider": self.provider_name,
                        "provider_symbol": provider_symbol,
                        "start_date": start_date.isoformat(),
                        "end_date": end_date.isoformat(),
                        "cached_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
                        "payload": payload,
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                ),
                encoding="utf-8",
            )
        except OSError:
            return

    def _retry_after_to_utc(self, retry_after: str) -> str:
        try:
            seconds = int(retry_after)
        except ValueError:
            return retry_after
        return (datetime.now(timezone.utc) + timedelta(seconds=max(seconds, 0))).isoformat().replace("+00:00", "Z")

    def _next_hour_retry_at(self) -> str:
        return (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(timespec="seconds").replace("+00:00", "Z")

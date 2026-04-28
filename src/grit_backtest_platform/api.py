from __future__ import annotations

import os
import threading
from pathlib import Path
import importlib
import json
import logging
import time
from typing import Any, Mapping

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from ._version import __version__
from .fallback_provider import ProviderExecutionSignal, provider_access_tier
from .models import (
    AssetLegCreateRequest,
    AssetLegResponseModel,
    AssetLegUpdateRequest,
    BacktestRunCloneRequest,
    BacktestRunCreateRequest,
    BacktestRunPreviewRequest,
    CashLegCreateRequest,
    CashLegResponseModel,
    CashLegUpdateRequest,
    CompositionCreateRequest,
    CompositionAllocationJobCreateRequest,
    CompositionAllocationJobResponseModel,
    CompositionBacktestOrderNettingModel,
    CompositionBacktestOrderPageModel,
    CompositionBacktestRunCreateRequest,
    CompositionBacktestRunResponseModel,
    CompositionDetailResponseModel,
    CompositionListItemModel,
    CompositionPreviewRequest,
    CompositionPreviewResponseModel,
    CompositionUpdateRequest,
    ConfirmationUpdateRequest,
    CreateCreationSessionRequest,
    CreationMessageCreate,
    LegInventoryResponseModel,
    MaterializeRequest,
    OptimizationCandidateCreateRequest,
    OptimizationJobConstraintUpdateRequest,
    OptimizationJobCreateRequest,
    ParameterVersionRestoreRequest,
    ResumeOptimizationJobRequest,
    PromoteTrialRequest,
    PrepareConfirmationRequest,
    SnapshotRefreshRequest,
    StrategyUpdateRequest,
)
from .real_service import RealBacktestPlatformService, SnapshotBlockingError
from .service import ContractConflictError
from .universe_history import default_universe_history_providers
from .yahoo_provider import YahooMarketDataProvider

logger = logging.getLogger(__name__)


def _provider_name(provider: Any) -> str:
    return str(getattr(provider, "provider_name", provider.__class__.__name__.lower()))


def _supports_corporate_action_probe(provider_or_name: Any) -> bool:
    if not isinstance(provider_or_name, str) and bool(getattr(provider_or_name, "supports_action_enrichment", False)):
        return True
    provider_name = str(provider_or_name if isinstance(provider_or_name, str) else _provider_name(provider_or_name))
    return provider_name.strip().lower() in {
        "yahoo",
        "yfinance",
        "tiingo",
        "alpha_vantage",
        "openbb_yfinance",
        "openbb_tiingo",
        "openbb_fmp",
    }


def _openbb_provider_enabled() -> bool:
    return str(os.getenv("GRIT_ENABLE_OPENBB_PROVIDER") or "").strip().lower() in {"1", "true", "yes", "on"}


def _load_provider(module_name: str, class_names: tuple[str, ...]) -> tuple[Any | None, str | None]:
    try:
        module = importlib.import_module(f".{module_name}", package=__package__)
    except Exception as exc:
        return None, f"module_import_failed: {exc}"
    last_reason: str | None = None
    for class_name in class_names:
        provider_class = getattr(module, class_name, None)
        if provider_class is None:
            last_reason = f"class_not_found: {class_name}"
            continue
        try:
            provider = provider_class()
        except Exception as exc:
            last_reason = f"provider_init_failed: {exc}"
            continue
        availability = getattr(provider, "availability", None)
        if callable(availability):
            try:
                report = availability()
            except Exception as exc:
                last_reason = f"availability_probe_failed: {exc}"
                continue
            if not getattr(report, "available", False):
                last_reason = str(getattr(report, "reason", None) or "provider unavailable")
                continue
        return provider, None
    return None, last_reason or "provider unavailable"


def _merge_action_payload(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = dict(existing)
    if merged.get("value") is None and incoming.get("value") is not None:
        merged["value"] = incoming.get("value")
    if not merged.get("source") and incoming.get("source"):
        merged["source"] = incoming.get("source")
    if not merged.get("fallback_source") and incoming.get("fallback_source"):
        merged["fallback_source"] = incoming.get("fallback_source")
    merged_payload = dict(merged.get("payload") or {})
    for key, value in dict(incoming.get("payload") or {}).items():
        if key not in merged_payload or merged_payload.get(key) is None:
            merged_payload[key] = value
    if merged_payload:
        merged["payload"] = merged_payload
    return merged


def _dedupe_actions(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    index_by_signature: dict[str, int] = {}
    deduped: list[dict[str, Any]] = []
    for action in actions:
        signature = json.dumps(
            {
                "symbol": str(action.get("symbol") or "").strip().upper(),
                "date": action.get("date") or action.get("event_date"),
                "action_type": action.get("action_type") or action.get("event_type"),
            },
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        )
        existing_index = index_by_signature.get(signature)
        if existing_index is None:
            index_by_signature[signature] = len(deduped)
            deduped.append(dict(action))
            continue
        deduped[existing_index] = _merge_action_payload(deduped[existing_index], action)
    return deduped


class RuntimeMarketDataFetchError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        warnings: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.warnings = list(warnings or [])
        self.metadata = dict(metadata or {})


def _missing_provider_kind(provider_name: str) -> str:
    normalized = str(provider_name or "").strip().lower()
    if normalized in {"alpha_vantage", "openbb_alpha_vantage"}:
        return "earnings_availability"
    if normalized == "sec_edgar":
        return "filings_availability"
    if normalized in {"tiingo_symbology", "longbridge_static_info"}:
        return "identity_availability"
    return "history_availability"


class RuntimeMarketDataProvider:
    provider_name = "yahoo"

    def __init__(
        self,
        providers: list[Any],
        missing_providers: list[str] | None = None,
        missing_provider_reasons: dict[str, str] | None = None,
        allow_targeted_price_repair: bool = False,
    ) -> None:
        self.providers = [provider for provider in providers if provider is not None]
        self.universe_history_providers = list(default_universe_history_providers())
        self.allow_targeted_price_repair = bool(allow_targeted_price_repair)
        self.price_providers = [
            provider
            for provider in self.providers
            if callable(getattr(provider, "fetch_history", None))
            and _provider_name(provider) not in {"alpha_vantage", "openbb_alpha_vantage", "sec_edgar"}
        ]
        self.price_provider_names = {_provider_name(provider) for provider in self.price_providers}
        self.targeted_price_repair_providers = [
            provider
            for provider in self.providers
            if callable(getattr(provider, "fetch_history", None))
            and _provider_name(provider) in {"alpha_vantage", "openbb_alpha_vantage"}
            and bool(getattr(provider, "supports_targeted_price_repair", False))
        ]
        self.targeted_price_repair_provider_names = {
            _provider_name(provider)
            for provider in self.targeted_price_repair_providers
        }
        self.corporate_action_providers = [
            provider
            for provider in self.providers
            if callable(getattr(provider, "fetch_corporate_actions", None))
            and _provider_name(provider) not in self.price_provider_names
        ]
        self.identity_providers = [
            provider for provider in self.providers if callable(getattr(provider, "resolve_identity", None))
        ]
        self.earnings_providers = [
            provider for provider in self.providers if callable(getattr(provider, "fetch_earnings", None))
        ]
        self.report_providers = [
            provider for provider in self.providers if callable(getattr(provider, "fetch_report_filings", None))
        ]
        self.fallback_provider = self.price_providers[1] if len(self.price_providers) > 1 else None
        self.missing_providers = list(missing_providers or [])
        self.missing_provider_reasons = {
            str(provider_name): str(reason)
            for provider_name, reason in dict(missing_provider_reasons or {}).items()
            if str(provider_name).strip()
        }

    def _copy_auxiliary_provider_state(self, clone: "RuntimeMarketDataProvider") -> "RuntimeMarketDataProvider":
        clone.universe_history_providers = list(self.universe_history_providers)
        for attr_name in ("bond_fixed_income_provider", "current_universe_constituent_checker"):
            if hasattr(self, attr_name):
                setattr(clone, attr_name, getattr(self, attr_name))
        return clone

    def scoped_copy(
        self,
        *,
        exclude_provider_names: set[str] | list[str] | tuple[str, ...] | None = None,
        allow_targeted_price_repair: bool | None = None,
    ) -> "RuntimeMarketDataProvider":
        excluded = {str(name or "").strip().lower() for name in (exclude_provider_names or []) if str(name or "").strip()}
        if not excluded:
            clone = type(self)(
                list(self.providers),
                missing_providers=list(self.missing_providers),
                missing_provider_reasons=dict(self.missing_provider_reasons),
                allow_targeted_price_repair=(
                    self.allow_targeted_price_repair
                    if allow_targeted_price_repair is None
                    else bool(allow_targeted_price_repair)
                ),
            )
            return self._copy_auxiliary_provider_state(clone)
        filtered = [
            provider
            for provider in self.providers
            if _provider_name(provider).strip().lower() not in excluded
        ]
        clone = type(self)(
            filtered,
            missing_providers=list(self.missing_providers),
            missing_provider_reasons=dict(self.missing_provider_reasons),
            allow_targeted_price_repair=(
                self.allow_targeted_price_repair
                if allow_targeted_price_repair is None
                else bool(allow_targeted_price_repair)
            ),
        )
        return self._copy_auxiliary_provider_state(clone)

    def resolve_identity(self, symbol: str) -> dict[str, Any] | None:
        for provider in self.identity_providers:
            resolver = getattr(provider, "resolve_identity", None)
            if resolver is None:
                continue
            try:
                identity = resolver(symbol)
            except Exception:
                continue
            if isinstance(identity, dict) and identity.get("symbol"):
                return identity
        return None

    def _normalize_history_payload(self, provider_name: str, result: Any) -> dict[str, Any]:
        if isinstance(result, dict):
            payload = dict(result)
        else:
            payload = {
                "source": getattr(result, "source", None),
                "fallback_source": getattr(result, "fallback_source", None),
                "bars": list(getattr(result, "bars", []) or []),
                "actions": list(getattr(result, "actions", []) or []),
                "warnings": list(getattr(result, "warnings", []) or []),
                "partial": bool(getattr(result, "partial", False)),
                "metadata": dict(getattr(result, "metadata", {}) or {}),
            }
        payload.setdefault("source", provider_name)
        payload.setdefault("fallback_source", None)
        payload.setdefault("bars", [])
        payload.setdefault("actions", [])
        payload.setdefault("warnings", [])
        payload.setdefault("partial", False)
        payload.setdefault("metadata", {})
        return payload

    def _append_actions(
        self,
        actions: list[dict[str, Any]],
        rows: list[dict[str, Any]],
        provider_name: str,
        *,
        primary_source: str | None,
    ) -> None:
        for item in rows:
            action = dict(item)
            action.setdefault("source", provider_name)
            if (
                primary_source
                and action.get("source") != primary_source
                and not action.get("fallback_source")
            ):
                action["fallback_source"] = action.get("source")
            actions.append(action)

    def _supports_action_enrichment(self, provider: Any) -> bool:
        return _supports_corporate_action_probe(provider)

    def _provider_access_tier(self, provider_or_name: Any) -> str:
        return provider_access_tier(provider_or_name)

    def _provider_signal_metadata(self, metadata: Mapping[str, Any] | None) -> dict[str, Any]:
        payload = dict(metadata or {})
        normalized: dict[str, Any] = {}
        for key in ("quota_limited", "probe_complete", "next_retry_at"):
            if key in payload:
                normalized[key] = payload.get(key)
        return normalized

    def _provider_result(
        self,
        *,
        provider_name: str,
        kind: str,
        status: str,
        source: str | None = None,
        fallback_source: str | None = None,
        bar_count: int = 0,
        action_count: int = 0,
        partial: bool = False,
        error: str | None = None,
        reason: str | None = None,
        selection_status: str | None = None,
        actions_supported: bool | None = None,
        access_tier: str | None = None,
        quota_limited: bool | None = None,
        probe_complete: bool | None = None,
        next_retry_at: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "provider": provider_name,
            "kind": kind,
            "status": status,
            "source": str(source or provider_name),
            "fallback_source": fallback_source,
            "bar_count": int(bar_count),
            "action_count": int(action_count),
            "partial": bool(partial),
        }
        if error:
            payload["error"] = str(error)
        if reason:
            payload["reason"] = str(reason)
        if selection_status:
            payload["selection_status"] = str(selection_status)
        payload["actions_supported"] = bool(actions_supported)
        payload["access_tier"] = (
            str(access_tier or "").strip().lower() or self._provider_access_tier(provider_name)
        )
        payload["quota_limited"] = bool(quota_limited)
        payload["probe_complete"] = bool(probe_complete)
        payload["next_retry_at"] = str(next_retry_at) if next_retry_at else None
        return payload

    def fetch_history(self, symbol, start_date, end_date):
        warnings: list[str] = []
        history_warnings: list[str] = []
        provider_results: list[dict[str, Any]] = []
        missing_labels: list[str] = []
        history_missing_labels: list[str] = []
        primary_source: str | None = None
        bars: list[Any] = []
        actions: list[dict[str, Any]] = []
        identity = self.resolve_identity(symbol)

        for index, provider in enumerate(self.price_providers):
            provider_name = _provider_name(provider)
            try:
                had_primary_before = bool(bars)
                payload = self._normalize_history_payload(
                    provider_name,
                    provider.fetch_history(symbol, start_date, end_date),
                )
            except ProviderExecutionSignal as exc:
                if exc.status in {"failed", "limited"}:
                    missing_labels.append(provider_name)
                    history_missing_labels.append(provider_name)
                if exc.reason:
                    warnings.append(f"{provider_name}: {exc.reason}")
                    history_warnings.append(f"{provider_name}: {exc.reason}")
                provider_results.append(
                    self._provider_result(
                        provider_name=provider_name,
                        kind="history",
                        status=exc.status,
                        error=str(exc),
                        reason=exc.reason,
                        actions_supported=self._supports_action_enrichment(provider),
                        access_tier=self._provider_access_tier(provider),
                        **self._provider_signal_metadata(exc.metadata),
                    )
                )
                continue
            except Exception as exc:
                missing_labels.append(provider_name)
                history_missing_labels.append(provider_name)
                warnings.append(f"{provider_name}: {exc}")
                history_warnings.append(f"{provider_name}: {exc}")
                provider_results.append(
                    self._provider_result(
                        provider_name=provider_name,
                        kind="history",
                        status="failed",
                        error=str(exc),
                        actions_supported=self._supports_action_enrichment(provider),
                        access_tier=self._provider_access_tier(provider),
                    )
                )
                continue

            provider_warnings = list(payload["warnings"] or [])
            warnings.extend(str(item) for item in provider_warnings if item)
            history_warnings.extend(str(item) for item in provider_warnings if item)
            provider_bars = list(payload.get("bars") or [])
            provider_actions = [dict(item) for item in (payload["actions"] or []) if isinstance(item, dict)]
            provider_results.append(
                self._provider_result(
                    provider_name=provider_name,
                    kind="history",
                    status="succeeded" if provider_bars or provider_actions else "empty",
                    source=str(payload.get("source") or provider_name),
                    fallback_source=payload.get("fallback_source"),
                    bar_count=len(provider_bars),
                    action_count=len(provider_actions),
                    partial=bool(payload.get("partial")),
                    actions_supported=self._supports_action_enrichment(provider),
                    access_tier=self._provider_access_tier(provider),
                    probe_complete=self._supports_action_enrichment(provider),
                    selection_status=(
                        "selected_primary"
                        if provider_bars and not had_primary_before
                        else ("succeeded_not_selected" if provider_bars and had_primary_before else None)
                    ),
                )
            )

            if provider_bars and not bars:
                bars = provider_bars
                primary_source = str(payload.get("source") or provider_name)
            if provider_actions:
                self._append_actions(actions, provider_actions, provider_name, primary_source=primary_source)
            provider_completed_probe = self._supports_action_enrichment(provider)
            if bars and (
                provider_completed_probe
                or not any(
                    self._supports_action_enrichment(candidate)
                    for candidate in self.price_providers[index + 1 :]
                )
            ):
                provider_results.extend(
                    self._provider_result(
                        provider_name=_provider_name(candidate),
                        kind="history",
                        status="skipped",
                        reason="primary_price_source_already_selected",
                        actions_supported=self._supports_action_enrichment(candidate),
                        access_tier=self._provider_access_tier(candidate),
                    )
                    for candidate in self.price_providers[index + 1 :]
                )
                break

        if not bars and self.allow_targeted_price_repair:
            for provider in self.targeted_price_repair_providers:
                provider_name = _provider_name(provider)
                try:
                    payload = self._normalize_history_payload(
                        provider_name,
                        provider.fetch_history(symbol, start_date, end_date),
                    )
                except ProviderExecutionSignal as exc:
                    if exc.status in {"failed", "limited"}:
                        missing_labels.append(provider_name)
                        history_missing_labels.append(provider_name)
                    if exc.reason:
                        warnings.append(f"{provider_name}: {exc.reason}")
                        history_warnings.append(f"{provider_name}: {exc.reason}")
                    provider_results.append(
                        self._provider_result(
                            provider_name=provider_name,
                            kind="targeted_price_repair",
                            status=exc.status,
                            error=str(exc),
                            reason=exc.reason,
                            actions_supported=False,
                            access_tier=self._provider_access_tier(provider),
                            **self._provider_signal_metadata(exc.metadata),
                        )
                    )
                    continue
                except Exception as exc:
                    missing_labels.append(provider_name)
                    history_missing_labels.append(provider_name)
                    warnings.append(f"{provider_name}: {exc}")
                    history_warnings.append(f"{provider_name}: {exc}")
                    provider_results.append(
                        self._provider_result(
                            provider_name=provider_name,
                            kind="targeted_price_repair",
                            status="failed",
                            error=str(exc),
                            actions_supported=False,
                            access_tier=self._provider_access_tier(provider),
                        )
                    )
                    continue

                provider_warnings = list(payload["warnings"] or [])
                warnings.extend(str(item) for item in provider_warnings if item)
                history_warnings.extend(str(item) for item in provider_warnings if item)
                provider_bars = list(payload.get("bars") or [])
                provider_actions = [dict(item) for item in (payload["actions"] or []) if isinstance(item, dict)]
                provider_results.append(
                    self._provider_result(
                        provider_name=provider_name,
                        kind="targeted_price_repair",
                        status="succeeded" if provider_bars or provider_actions else "empty",
                        source=str(payload.get("source") or provider_name),
                        fallback_source=payload.get("fallback_source"),
                        bar_count=len(provider_bars),
                        action_count=len(provider_actions),
                        partial=bool(payload.get("partial")),
                        reason="targeted_price_repair",
                        selection_status="selected_primary" if provider_bars else None,
                        actions_supported=False,
                        access_tier=self._provider_access_tier(provider),
                    )
                )
                if provider_bars:
                    bars = provider_bars
                    primary_source = str(payload.get("source") or provider_name)
                if provider_actions:
                    self._append_actions(actions, provider_actions, provider_name, primary_source=primary_source)
                if bars:
                    break

        for provider in self.corporate_action_providers:
            provider_name = _provider_name(provider)
            fetch_corporate_actions = getattr(provider, "fetch_corporate_actions", None)
            if fetch_corporate_actions is None:
                continue
            try:
                corporate_payload = fetch_corporate_actions(symbol, start_date, end_date) or {}
            except ProviderExecutionSignal as exc:
                missing_labels.append(provider_name)
                if exc.reason:
                    warnings.append(f"{provider_name}: {exc.reason}")
                provider_results.append(
                    self._provider_result(
                        provider_name=provider_name,
                        kind="history_availability",
                        status=exc.status,
                        error=str(exc),
                        reason=exc.reason,
                        actions_supported=True,
                        access_tier=self._provider_access_tier(provider),
                        **self._provider_signal_metadata(exc.metadata),
                    )
                )
                continue
            except Exception as exc:
                missing_labels.append(provider_name)
                warnings.append(f"{provider_name}: {exc}")
                provider_results.append(
                    self._provider_result(
                        provider_name=provider_name,
                        kind="history_availability",
                        status="failed",
                        error=str(exc),
                        actions_supported=True,
                        access_tier=self._provider_access_tier(provider),
                    )
                )
                continue

            provider_actions = [
                dict(item)
                for item in (corporate_payload.get("actions") or [])
                if isinstance(item, dict)
            ]
            provider_metadata = dict(corporate_payload.get("metadata") or {})
            warnings.extend(str(item) for item in (corporate_payload.get("warnings") or []) if item)
            provider_results.append(
                self._provider_result(
                    provider_name=provider_name,
                    kind="history_availability",
                    status="succeeded" if provider_actions or corporate_payload.get("probe_complete") else "empty",
                    source=str(corporate_payload.get("source") or provider_name),
                    action_count=len(provider_actions),
                    actions_supported=True,
                    access_tier=str(provider_metadata.get("access_tier") or self._provider_access_tier(provider)),
                    quota_limited=provider_metadata.get("quota_limited"),
                    probe_complete=bool(
                        corporate_payload.get("probe_complete") or provider_metadata.get("probe_complete")
                    ),
                    next_retry_at=str(provider_metadata.get("next_retry_at") or "") or None,
                )
            )
            if provider_actions:
                self._append_actions(actions, provider_actions, provider_name, primary_source=primary_source)

        for provider in self.earnings_providers:
            provider_name = _provider_name(provider)
            fetch_earnings = getattr(provider, "fetch_earnings", None)
            if fetch_earnings is None:
                continue
            try:
                earnings_rows = list(fetch_earnings(symbol) or [])
            except Exception as exc:
                missing_labels.append(provider_name)
                warnings.append(f"{provider_name}: {exc}")
                provider_results.append(
                    self._provider_result(
                        provider_name=provider_name,
                        kind="earnings",
                        status="failed",
                        error=str(exc),
                        access_tier=self._provider_access_tier(provider),
                    )
                )
                continue
            converted: list[dict[str, Any]] = []
            for item in earnings_rows:
                if not isinstance(item, dict):
                    continue
                reported_date = str(item.get("reported_date") or "")[:10]
                if not reported_date or reported_date < start_date.isoformat() or reported_date > end_date.isoformat():
                    continue
                converted.append(
                    {
                        "date": reported_date,
                        "action_type": "earnings_report",
                        "value": item.get("reported_eps"),
                        "source": provider_name,
                        "payload": {
                            "period": item.get("period"),
                            "fiscal_date_ending": item.get("fiscal_date_ending"),
                            "reported_eps": item.get("reported_eps"),
                            "estimated_eps": item.get("estimated_eps"),
                            "surprise": item.get("surprise"),
                            "surprise_percentage": item.get("surprise_percentage"),
                        },
                    }
                )
            provider_results.append(
                self._provider_result(
                    provider_name=provider_name,
                    kind="earnings",
                    status="succeeded" if converted else "empty",
                    source=provider_name,
                    action_count=len(converted),
                    access_tier=self._provider_access_tier(provider),
                )
            )
            self._append_actions(actions, converted, provider_name, primary_source=primary_source)

        for provider in self.report_providers:
            provider_name = _provider_name(provider)
            fetch_report_filings = getattr(provider, "fetch_report_filings", None)
            if fetch_report_filings is None:
                continue
            try:
                filing_rows = list(fetch_report_filings(symbol, start_date, end_date) or [])
            except Exception as exc:
                missing_labels.append(provider_name)
                warnings.append(f"{provider_name}: {exc}")
                provider_results.append(
                    self._provider_result(
                        provider_name=provider_name,
                        kind="filings",
                        status="failed",
                        error=str(exc),
                        access_tier=self._provider_access_tier(provider),
                    )
                )
                continue
            converted = [dict(item) for item in filing_rows if isinstance(item, dict)]
            provider_results.append(
                self._provider_result(
                    provider_name=provider_name,
                    kind="filings",
                    status="succeeded" if converted else "empty",
                    source=provider_name,
                    action_count=len(converted),
                    access_tier=self._provider_access_tier(provider),
                )
            )
            self._append_actions(actions, converted, provider_name, primary_source=primary_source)

        actions = _dedupe_actions(actions)
        unavailable_providers = list(self.missing_providers)
        provider_results.extend(
            self._provider_result(
                provider_name=provider_name,
                kind=(
                    "targeted_price_repair_availability"
                    if self.allow_targeted_price_repair
                    and provider_name in (self.targeted_price_repair_provider_names | {"openbb_alpha_vantage"})
                    else _missing_provider_kind(provider_name)
                ),
                status="unavailable",
                reason=self.missing_provider_reasons.get(provider_name) or "provider_not_configured_or_unavailable",
                actions_supported=_supports_corporate_action_probe(provider_name),
                access_tier=self._provider_access_tier(provider_name),
            )
            for provider_name in unavailable_providers
        )
        if not bars:
            history_unavailable_providers = [
                provider_name
                for provider_name in unavailable_providers
                if (
                    _missing_provider_kind(provider_name) == "history_availability"
                    or (
                        self.allow_targeted_price_repair
                        and provider_name in (self.targeted_price_repair_provider_names | {"openbb_alpha_vantage"})
                    )
                )
            ]
            history_missing_provider_reasons = {
                provider_name: reason
                for provider_name, reason in self.missing_provider_reasons.items()
                if (
                    _missing_provider_kind(provider_name) == "history_availability"
                    or (
                        self.allow_targeted_price_repair
                        and provider_name in (self.targeted_price_repair_provider_names | {"openbb_alpha_vantage"})
                    )
                )
            }
            raise RuntimeMarketDataFetchError(
                f"No provider returned market data for {symbol}. "
                + ("; ".join(history_warnings) if history_warnings else "No usable price providers were configured."),
                warnings=history_warnings,
                metadata={
                    "provider_chain": [_provider_name(provider) for provider in self.providers],
                    "provider_results": provider_results,
                    "bar_source": None,
                    "fallback_sources": [],
                    "missing_providers": history_unavailable_providers + history_missing_labels,
                    "missing_provider_reasons": history_missing_provider_reasons,
                    "history_warnings": history_warnings,
                    "enrichment_warnings": [
                        item for item in warnings if item not in history_warnings
                    ],
                    "identity": identity or {},
                },
            )

        contributing_sources = sorted(
            {
                str(item.get("source") or "")
                for item in actions
                if item.get("source")
            }
            | {primary_source or ""}
        )
        fallback_sources = sorted(
            {
                str(action.get("fallback_source"))
                for action in actions
                if action.get("fallback_source") and str(action.get("fallback_source")) != (primary_source or "")
            }
        )
        primary_source = primary_source or (self.price_providers[0].provider_name if self.price_providers else "yahoo")
        secondary_sources = [source for source in contributing_sources if source and source != primary_source]
        fallback_source: str | None = None
        if fallback_sources:
            fallback_source = fallback_sources[0] if len(fallback_sources) == 1 else "mixed_fallbacks"
        elif secondary_sources:
            fallback_source = secondary_sources[0] if len(secondary_sources) == 1 else "mixed_fallbacks"
        elif len(self.price_providers) > 1:
            fallback_source = "mixed_fallbacks"

        provider_gaps = unavailable_providers
        return {
            "symbol": symbol,
            "bars": bars,
            "actions": actions,
            "source": primary_source,
            "fallback_source": fallback_source,
            "warnings": warnings,
            "partial": bool(missing_labels or provider_gaps),
            "metadata": {
                "provider_chain": [_provider_name(provider) for provider in self.providers],
                "provider_results": provider_results,
                "bar_source": primary_source,
                "fallback_sources": fallback_sources or secondary_sources,
                "missing_providers": provider_gaps + missing_labels,
                "missing_provider_reasons": dict(self.missing_provider_reasons),
                "history_warnings": history_warnings,
                "enrichment_warnings": [
                    item for item in warnings if item not in history_warnings
                ],
                "identity": identity or {},
            },
        }


def build_runtime_market_data_provider() -> RuntimeMarketDataProvider:
    providers: list[Any] = [YahooMarketDataProvider()]
    missing_providers: list[str] = []
    missing_provider_reasons: dict[str, str] = {}
    provider_specs = [
        ("yfinance", "yfinance_provider", ("YfinanceMarketDataProvider",)),
        ("tiingo", "tiingo_provider", ("TiingoMarketDataProvider", "TiingoProvider")),
        ("tiingo_symbology", "tiingo_symbology_provider", ("TiingoSymbologyProvider",)),
        ("longbridge_static_info", "longbridge_provider", ("LongbridgeStaticInfoProvider",)),
        ("longbridge", "longbridge_provider", ("LongbridgeQuoteProvider",)),
        ("akshare_us", "akshare_us_provider", ("AkshareUsPriceProvider", "AkShareUsPriceProvider")),
        ("stooq", "stooq_provider", ("StooqZipPriceProvider", "StooqPriceProvider")),
        ("fmp", "fmp_identity_provider", ("FmpIdentityRepairProvider", "FmpMarketDataProvider", "FmpPriceRepairProvider")),
        ("alpha_vantage", "alpha_vantage_provider", ("AlphaVantageProvider", "AlphaVantageEventProvider", "AlphaVantageMarketDataProvider")),
        ("sec_edgar", "sec_edgar_provider", ("SecEdgarEventProvider", "SecEdgarProvider")),
    ]
    openbb_enabled = _openbb_provider_enabled()
    if openbb_enabled:
        provider_specs.extend(
            [
                ("openbb_yfinance", "openbb_provider", ("OpenBBYfinanceMarketDataProvider",)),
                ("openbb_tiingo", "openbb_provider", ("OpenBBTiingoMarketDataProvider",)),
                ("openbb_fmp", "openbb_provider", ("OpenBBFmpMarketDataProvider",)),
                ("openbb_alpha_vantage", "openbb_provider", ("OpenBBAlphaVantagePriceRepairProvider",)),
            ]
        )
    for provider_label, module_name, class_names in provider_specs:
        provider, reason = _load_provider(module_name, class_names)
        if provider is not None:
            providers.append(provider)
        else:
            missing_providers.append(provider_label)
            if reason:
                missing_provider_reasons[provider_label] = str(reason)
    runtime_provider = RuntimeMarketDataProvider(
        providers,
        missing_providers=missing_providers,
        missing_provider_reasons=missing_provider_reasons,
    )
    if openbb_enabled:
        try:
            openbb_module = importlib.import_module(".openbb_provider", package=__package__)
            runtime_provider.bond_fixed_income_provider = openbb_module.OpenBBBondFixedIncomeProvider()
            runtime_provider.current_universe_constituent_checker = (
                openbb_module.OpenBBCurrentUniverseConstituentCheckProvider()
            )
        except Exception as exc:
            runtime_provider.missing_providers.extend(["openbb_bond_fixed_income", "openbb_index_constituents"])
            missing_provider_reasons["openbb_bond_fixed_income"] = f"provider_init_failed: {exc}"
            missing_provider_reasons["openbb_index_constituents"] = f"provider_init_failed: {exc}"
            runtime_provider.missing_provider_reasons.update(
                {
                    "openbb_bond_fixed_income": missing_provider_reasons["openbb_bond_fixed_income"],
                    "openbb_index_constituents": missing_provider_reasons["openbb_index_constituents"],
                }
            )
    return runtime_provider


def _default_db_path() -> Path:
    configured = os.getenv('GRIT_BACKTEST_DB')
    return Path(configured) if configured else Path.cwd() / '.grit_backtest_platform.sqlite3'


def create_app(
    db_path: str | Path | None = None,
    market_data_provider=None,
    *,
    startup_optimization_recovery_mode: str | None = None,
) -> FastAPI:
    app = FastAPI(title='Grit Backtest Platform', version=__version__)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            'http://127.0.0.1:4173',
            'http://localhost:4173',
            'http://127.0.0.1:5173',
            'http://localhost:5173',
        ],
        allow_methods=['*'],
        allow_headers=['*'],
    )
    resolved_market_data_provider = market_data_provider
    if resolved_market_data_provider is None and "PYTEST_CURRENT_TEST" not in os.environ:
        resolved_market_data_provider = build_runtime_market_data_provider()
    service = RealBacktestPlatformService(
        db_path or _default_db_path(),
        market_data_provider=resolved_market_data_provider,
    )
    normalized_startup_optimization_recovery_mode = str(
        startup_optimization_recovery_mode
        or os.getenv("GRIT_STARTUP_OPTIMIZATION_RECOVERY")
        or "resume"
    ).strip().lower()
    if normalized_startup_optimization_recovery_mode not in {"resume", "interrupt", "skip"}:
        normalized_startup_optimization_recovery_mode = "resume"
    app.state.service = service
    app.state.startup_optimization_recovery_mode = normalized_startup_optimization_recovery_mode
    app.state.cleanup_stop_event = threading.Event()
    app.state.cleanup_thread = None

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException):
        payload = exc.detail if isinstance(exc.detail, dict) else {'status': exc.status_code, 'code': 'error', 'message': str(exc.detail)}
        return JSONResponse(status_code=exc.status_code, content=payload)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError):
        message = exc.errors()[0]['msg'] if exc.errors() else 'Validation error'
        return JSONResponse(status_code=422, content={'status': 422, 'code': 'validation_error', 'message': message})

    def invoke(callback, *args, **kwargs):
        try:
            return callback(*args, **kwargs)
        except SnapshotBlockingError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        except ContractConflictError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        except KeyError as exc:
            raise HTTPException(status_code=404, detail={'status': 404, 'code': 'not_found', 'message': str(exc)}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={'status': 400, 'code': 'bad_request', 'message': str(exc)}) from exc

    def with_bond_snapshot_extension(payload: Any) -> Any:
        if not isinstance(payload, Mapping):
            return payload
        enriched = dict(payload)
        builder = getattr(service, "build_bond_fixed_income_snapshot_overview", None)
        if callable(builder):
            try:
                enriched["bond_fixed_income"] = builder(enriched)
            except Exception:
                enriched["bond_fixed_income"] = {
                    "global_pulse": {
                        "status": "ACTION_REQUIRED",
                        "headline": "Bond and fixed-income governance is unavailable because the shared snapshot overview could not be extended.",
                        "updated_at": enriched.get("last_refreshed_at"),
                        "cards": [],
                    },
                    "pillar_groups": [],
                    "curve_preview": [],
                    "audit_matrix": [],
                    "raw_registry": [],
                    "scheduler": {
                        "status": "ACTION_REQUIRED",
                        "cadence_label": "Shared snapshot cadence",
                        "next_action": "refresh_snapshots",
                        "last_job_id": None,
                    },
                    "selected_source_summary": {
                        "primary_source": "shared_snapshot_overview",
                        "fallback_source": None,
                        "selection_reason": "Fallback payload generated in the API layer.",
                    },
                    "system_diagnostics": {
                        "blocking_code": enriched.get("blocking_code"),
                        "blocking_target": enriched.get("blocking_target"),
                        "refresh_job_status": (
                            dict(enriched.get("latest_job"))
                            if isinstance(enriched.get("latest_job"), Mapping)
                            else {}
                        ).get("status"),
                        "memory": {},
                        "notes": ["Snapshot extension fallback was used."],
                    },
                }
        return enriched

    def run_cleanup_cycle() -> None:
        try:
            invoke(service.purge_expired_temporary_runs)
        except Exception:
            pass

    @app.on_event('startup')
    def startup_cleanup_worker():
        run_cleanup_cycle()
        try:
            invoke(service.resume_incomplete_backtest_runs)
        except Exception:
            pass
        if app.state.startup_optimization_recovery_mode == "resume":
            try:
                invoke(service.resume_incomplete_optimization_jobs)
            except Exception:
                pass
        elif app.state.startup_optimization_recovery_mode == "interrupt":
            try:
                invoke(service.interrupt_incomplete_optimization_jobs)
            except Exception:
                pass

        def loop() -> None:
            while not app.state.cleanup_stop_event.wait(24 * 60 * 60):
                run_cleanup_cycle()

        thread = threading.Thread(target=loop, name='cleanup-worker', daemon=True)
        app.state.cleanup_thread = thread
        thread.start()

    @app.on_event('shutdown')
    def shutdown_cleanup_worker():
        app.state.cleanup_stop_event.set()
        thread = app.state.cleanup_thread
        if thread and thread.is_alive():
            thread.join(timeout=5)

    @app.get('/healthz')
    def healthz():
        return {'status': 'ok'}

    @app.get('/workspace/overview')
    def workspace_overview(include_cleanup_audit: bool = Query(default=False)):
        return invoke(service.get_workspace_overview, include_cleanup_audit)

    @app.get('/strategies')
    def list_strategies():
        return invoke(service.list_strategies)

    @app.get('/strategies/{strategy_id}/detail')
    def strategy_detail(strategy_id: str):
        return invoke(service.get_strategy_detail, strategy_id)

    @app.patch('/strategies/{strategy_id}')
    def patch_strategy(strategy_id: str, payload: StrategyUpdateRequest):
        return invoke(service.update_strategy, strategy_id, payload)

    @app.post('/strategies/{strategy_id}/parameter-versions/{parameter_version_id}/restore')
    def restore_strategy_parameter_version(
        strategy_id: str,
        parameter_version_id: str,
        payload: ParameterVersionRestoreRequest,
    ):
        return invoke(service.restore_strategy_parameter_version, strategy_id, parameter_version_id, payload)

    @app.post('/strategy-creation-sessions')
    def create_creation_session(payload: CreateCreationSessionRequest | None = None):
        return invoke(service.create_creation_session, payload or CreateCreationSessionRequest())

    @app.get('/strategy-creation-sessions/{session_id}')
    def get_creation_session(session_id: str):
        return invoke(service.get_creation_session, session_id)

    @app.post('/strategy-creation-sessions/{session_id}/messages')
    def append_creation_message(session_id: str, payload: CreationMessageCreate):
        return invoke(service.append_creation_message, session_id, payload)

    @app.post('/strategy-creation-sessions/{session_id}/prepare-confirmation')
    def prepare_confirmation(session_id: str, payload: PrepareConfirmationRequest | None = None):
        return invoke(service.prepare_confirmation, session_id, payload or PrepareConfirmationRequest())

    @app.patch('/strategy-creation-sessions/{session_id}/confirmation')
    def update_creation_confirmation(session_id: str, payload: ConfirmationUpdateRequest):
        updater = getattr(service, 'update_creation_confirmation', service.update_confirmation)
        return invoke(updater, session_id, payload)

    @app.post('/strategy-creation-sessions/{session_id}/materialize')
    def materialize_strategy(session_id: str, payload: MaterializeRequest):
        return invoke(service.materialize_strategy, session_id, payload)

    @app.get('/backtest-runs')
    def list_backtest_runs(limit: int | None = Query(default=None, ge=1), status: str | None = None):
        return invoke(service.list_backtest_runs, limit=limit, status=status)

    @app.get('/backtest-runs/{run_id}/detail')
    def backtest_run_detail(run_id: str, view: str = Query(default="full")):
        return invoke(service.get_backtest_run_detail, run_id, view=view)

    @app.post('/backtest-runs/{run_id}/save')
    def save_backtest_run(run_id: str):
        return invoke(service.save_backtest_run, run_id)

    @app.delete('/backtest-runs/{run_id}')
    def delete_backtest_run(run_id: str):
        return invoke(service.delete_backtest_run, run_id)

    @app.get('/backtest-runs/{run_id}/trades')
    def backtest_run_trades(run_id: str, page: int = 1, page_size: int = 50, segment: str = 'all'):
        return invoke(service.get_backtest_run_trades, run_id, page=page, page_size=page_size, segment=segment)

    @app.get('/backtest-runs/{run_id}/trades/{trade_id}/audit')
    def backtest_trade_audit(run_id: str, trade_id: str):
        return invoke(service.get_backtest_trade_audit, run_id, trade_id)

    @app.post('/strategies/{strategy_id}/backtest-runs')
    def submit_backtest_run(strategy_id: str, payload: BacktestRunCreateRequest):
        return invoke(service.submit_backtest_run, strategy_id, payload)

    @app.post('/strategies/{strategy_id}/backtest-runs/preview')
    def preview_backtest_run(strategy_id: str, payload: BacktestRunPreviewRequest | None = None):
        return invoke(service.preview_backtest_run, strategy_id, payload or BacktestRunPreviewRequest())

    @app.post('/backtest-runs/{run_id}/clone')
    def clone_backtest_run(run_id: str, payload: BacktestRunCloneRequest):
        return invoke(service.clone_backtest_run, run_id, payload)

    @app.get('/leg-inventory', response_model=LegInventoryResponseModel)
    def leg_inventory():
        return invoke(service.list_leg_inventory)

    @app.post('/asset-legs', response_model=AssetLegResponseModel)
    def create_asset_leg(payload: AssetLegCreateRequest):
        return invoke(service.create_asset_leg, payload)

    @app.patch('/asset-legs/{leg_id}', response_model=AssetLegResponseModel)
    def update_asset_leg(leg_id: str, payload: AssetLegUpdateRequest):
        return invoke(service.update_asset_leg, leg_id, payload)

    @app.post('/cash-legs', response_model=CashLegResponseModel)
    def create_cash_leg(payload: CashLegCreateRequest):
        return invoke(service.create_cash_leg, payload)

    @app.patch('/cash-legs/{leg_id}', response_model=CashLegResponseModel)
    def update_cash_leg(leg_id: str, payload: CashLegUpdateRequest):
        return invoke(service.update_cash_leg, leg_id, payload)

    @app.get('/compositions', response_model=list[CompositionListItemModel])
    def list_compositions():
        return invoke(service.list_compositions)

    @app.get('/compositions/{composition_id}', response_model=CompositionDetailResponseModel)
    def composition_detail(composition_id: str):
        return invoke(service.get_composition_detail, composition_id)

    @app.post('/compositions/preview', response_model=CompositionPreviewResponseModel)
    def preview_composition(payload: CompositionPreviewRequest):
        return invoke(service.preview_composition, payload)

    @app.post('/compositions', response_model=CompositionDetailResponseModel)
    def create_composition(payload: CompositionCreateRequest):
        return invoke(service.create_composition, payload)

    @app.patch('/compositions/{composition_id}', response_model=CompositionDetailResponseModel)
    def update_composition(composition_id: str, payload: CompositionUpdateRequest):
        return invoke(service.update_composition, composition_id, payload)

    @app.post('/compositions/{composition_id}/backtest-runs', response_model=CompositionBacktestRunResponseModel)
    def create_composition_backtest_run(composition_id: str, payload: CompositionBacktestRunCreateRequest):
        return invoke(service.create_composition_backtest_run, composition_id, payload)

    @app.get('/compositions/{composition_id}/backtest-runs/{run_id}', response_model=CompositionBacktestRunResponseModel)
    def composition_backtest_run_detail(composition_id: str, run_id: str):
        return invoke(service.get_composition_backtest_run, composition_id, run_id)

    @app.get('/compositions/{composition_id}/backtest-runs/{run_id}/orders', response_model=CompositionBacktestOrderPageModel)
    def composition_backtest_orders(
        composition_id: str,
        run_id: str,
        page: int = Query(default=1, ge=1),
        page_size: int = Query(default=100, ge=1, le=500),
        symbol: str | None = Query(default=None),
    ):
        return invoke(
            service.get_composition_backtest_orders,
            composition_id,
            run_id,
            page=page,
            page_size=page_size,
            symbol=symbol,
        )

    @app.get('/compositions/{composition_id}/backtest-runs/{run_id}/orders/{order_id}/netting', response_model=CompositionBacktestOrderNettingModel)
    def composition_backtest_order_netting(composition_id: str, run_id: str, order_id: str):
        return invoke(service.get_composition_backtest_order_netting, composition_id, run_id, order_id)

    @app.get('/compositions/{composition_id}/backtest-runs/{run_id}/orders/export')
    def composition_backtest_orders_export(
        composition_id: str,
        run_id: str,
        format: str = Query(default='csv', pattern='^(csv|xlsx)$'),
        symbol: str | None = Query(default=None),
    ):
        payload = invoke(
            service.export_composition_backtest_orders,
            composition_id,
            run_id,
            export_format=format,
            symbol=symbol,
        )
        if isinstance(payload, Mapping) and payload.get("status") == "not_supported":
            return JSONResponse(status_code=501, content=dict(payload))
        raw_content = payload.get("content", "") if isinstance(payload, Mapping) else payload
        content = raw_content if isinstance(raw_content, (bytes, bytearray)) else str(raw_content)
        filename = str(payload.get("filename", f"{run_id}-orders.csv")) if isinstance(payload, Mapping) else f"{run_id}-orders.csv"
        media_type = str(payload.get("media_type", "text/csv; charset=utf-8")) if isinstance(payload, Mapping) else "text/csv; charset=utf-8"
        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    @app.post('/compositions/{composition_id}/allocation-jobs', response_model=CompositionAllocationJobResponseModel)
    def create_composition_allocation_job(composition_id: str, payload: CompositionAllocationJobCreateRequest):
        return invoke(service.create_composition_allocation_job, composition_id, payload)

    @app.get('/compositions/{composition_id}/allocation-jobs/{job_id}', response_model=CompositionAllocationJobResponseModel)
    def composition_allocation_job_detail(composition_id: str, job_id: str):
        return invoke(service.get_composition_allocation_job, composition_id, job_id)

    @app.get('/optimization-jobs')
    def list_optimization_jobs():
        return invoke(service.list_optimization_jobs)

    @app.get('/optimization-jobs/{job_id}/detail')
    def optimization_job_detail(job_id: str):
        start_time = time.perf_counter()
        response = invoke(service.get_optimization_job_detail, job_id)
        elapsed_ms = (time.perf_counter() - start_time) * 1000.0
        metrics = {}
        if hasattr(service, "get_optimization_job_detail_metrics"):
            try:
                raw_metrics = service.get_optimization_job_detail_metrics()
                if isinstance(raw_metrics, Mapping):
                    metrics = dict(raw_metrics)
            except Exception:
                metrics = {}
        logger.info(
            "optimization_job_detail request",
            extra={
                "route": "optimization_job_detail",
                "job_id": job_id,
                "duration_ms": round(elapsed_ms, 2),
                "request_count": metrics.get("request_count"),
                "avg_duration_ms": metrics.get("avg_duration_ms"),
                "snapshot_query_count": metrics.get("snapshot_query_count"),
                "snapshot_cache_hit_rate": metrics.get("snapshot_cache_hit_rate"),
            },
        )
        return response

    @app.patch('/optimization-jobs/{job_id}')
    def update_optimization_job(job_id: str, payload: OptimizationJobConstraintUpdateRequest):
        return invoke(service.update_optimization_job_constraints, job_id, payload)

    @app.delete('/optimization-jobs/{job_id}')
    def delete_optimization_job(job_id: str):
        return invoke(service.delete_optimization_job, job_id)

    @app.post('/strategies/{strategy_id}/optimization-jobs')
    def create_optimization_job(strategy_id: str, payload: OptimizationJobCreateRequest | None = None):
        return invoke(service.create_optimization_job, strategy_id, payload)

    @app.post('/optimization-jobs/{job_id}/resume')
    def resume_optimization_job(job_id: str, payload: ResumeOptimizationJobRequest):
        return invoke(service.resume_optimization_job, job_id, payload)

    @app.post('/optimization-jobs/{job_id}/candidates')
    def create_optimization_candidate(job_id: str, payload: OptimizationCandidateCreateRequest):
        return invoke(service.create_optimization_candidate, job_id, payload)

    @app.post('/optimization-jobs/{job_id}/candidates/{trial_id}/promote')
    def promote_candidate(job_id: str, trial_id: str, payload: PromoteTrialRequest):
        return invoke(service.promote_trial, job_id, trial_id, payload)

    @app.delete('/optimization-jobs/{job_id}/candidates/{trial_id}')
    def delete_candidate(job_id: str, trial_id: str):
        return invoke(service.delete_optimization_candidate, job_id, trial_id)

    @app.get('/data-snapshots/overview')
    def snapshot_overview():
        return with_bond_snapshot_extension(invoke(service.get_snapshot_overview))

    @app.post('/admin/snapshot-refresh-jobs')
    def refresh_snapshots(payload: SnapshotRefreshRequest | None = None):
        request_payload = payload or SnapshotRefreshRequest()
        if "PYTEST_CURRENT_TEST" in os.environ:
            return with_bond_snapshot_extension(invoke(service.refresh_snapshots, request_payload))
        starter = getattr(service, "start_snapshot_refresh", None)
        if callable(starter):
            return with_bond_snapshot_extension(invoke(starter, request_payload))
        return with_bond_snapshot_extension(invoke(service.refresh_snapshots, request_payload))

    return app



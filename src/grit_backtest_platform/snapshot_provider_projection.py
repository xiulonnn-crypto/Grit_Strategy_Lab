from __future__ import annotations

import hashlib
import os
from collections.abc import Sequence as SequenceABC
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping, Sequence

from .fallback_provider import provider_access_tier
from .pit_external_sources import kaggle_credential_status, polygon_credential_status


OPENBB_ENABLE_VALUES = {"1", "true", "yes", "on"}
ATTEMPT_ROLLUP_POLICY = "unique_provider_latest_job_priority"
SOURCE_GOVERNANCE: dict[str, dict[str, Any]] = {
    "github_sp500_historical_components": {
        "source_url": "https://github.com/fja05680/sp500",
        "license": "upstream_repository",
        "source_manifest_required": True,
    },
    "kaggle_huge_stock_market_dataset": {
        "source_url": "https://www.kaggle.com/datasets/borismarjanovic/price-volume-data-for-all-us-stocks-etfs",
        "license": "CC0: Public Domain",
        "source_manifest_required": True,
    },
    "kaggle_delisted_bulk_archive": {
        "source_url": "https://www.kaggle.com/datasets/rodas86/arandkei-historical-delisted-assets-archive",
        "license": "verify_before_import",
        "source_manifest_required": True,
    },
    "polygon": {
        "source_url": "https://polygon.io/docs/rest/stocks/aggregates/custom-bars",
        "license": "account_terms",
        "source_manifest_required": False,
    },
}


@dataclass(frozen=True)
class ProviderDefinition:
    provider_id: str
    source_name: str
    access_tier: str
    target_types: tuple[str, ...]
    fallback_order: tuple[tuple[str, int], ...] = ()
    required_env_vars: tuple[str, ...] = ()
    optional_layer: str | None = None
    pit_mode: str = "evidence_source"
    can_upgrade_pit_readiness: bool = True
    pit_notes: tuple[str, ...] = ()


def _definition(
    provider_id: str,
    source_name: str,
    access_tier: str,
    target_types: Sequence[str],
    *,
    fallback_order: Mapping[str, int] | None = None,
    required_env_vars: Sequence[str] = (),
    optional_layer: str | None = None,
    pit_mode: str = "evidence_source",
    can_upgrade_pit_readiness: bool = True,
    pit_notes: Sequence[str] = (),
) -> ProviderDefinition:
    return ProviderDefinition(
        provider_id=provider_id,
        source_name=source_name,
        access_tier=access_tier,
        target_types=tuple(dict.fromkeys(str(item) for item in target_types if str(item).strip())),
        fallback_order=tuple(sorted((str(key), int(value)) for key, value in dict(fallback_order or {}).items())),
        required_env_vars=tuple(dict.fromkeys(str(item) for item in required_env_vars if str(item).strip())),
        optional_layer=optional_layer,
        pit_mode=pit_mode,
        can_upgrade_pit_readiness=can_upgrade_pit_readiness,
        pit_notes=tuple(str(item) for item in pit_notes if str(item).strip()),
    )


PROVIDER_DEFINITIONS: dict[str, ProviderDefinition] = {
    item.provider_id: item
    for item in (
        _definition(
            "yahoo",
            "Yahoo Finance",
            "public",
            ("price_history", "corporate_actions"),
            fallback_order={"price_history": 1, "corporate_actions": 1},
        ),
        _definition(
            "yfinance",
            "yfinance",
            "public",
            ("price_history", "corporate_actions"),
            fallback_order={"price_history": 2, "corporate_actions": 2},
        ),
        _definition(
            "tiingo",
            "Tiingo",
            "free_account",
            ("price_history", "corporate_actions"),
            fallback_order={"price_history": 3, "corporate_actions": 3},
            required_env_vars=("TIINGO_API_TOKEN",),
        ),
        _definition(
            "tiingo_symbology",
            "Tiingo Symbology",
            "free_account",
            ("identity",),
            fallback_order={"identity": 1},
            required_env_vars=("TIINGO_API_TOKEN",),
        ),
        _definition(
            "longbridge",
            "Longbridge Quote",
            "paid_optional",
            ("price_history",),
            fallback_order={"price_history": 4},
        ),
        _definition(
            "longbridge_static_info",
            "Longbridge Static Info",
            "paid_optional",
            ("identity",),
            fallback_order={"identity": 2},
        ),
        _definition(
            "akshare_us",
            "AkShare US",
            "public",
            ("price_history",),
            fallback_order={"price_history": 5},
        ),
        _definition(
            "stooq",
            "Stooq Offline ZIP",
            "public",
            ("price_history",),
            fallback_order={"price_history": 6},
            pit_mode="price_only",
            can_upgrade_pit_readiness=True,
            pit_notes=("Price evidence only; corporate-action readiness still requires an action-capable provider.",),
        ),
        _definition(
            "github_sp500_historical_components",
            "GitHub S&P 500 Historical Components",
            "public",
            ("universe_history", "membership_matrix"),
            fallback_order={"universe_history": 1, "membership_matrix": 1},
            pit_mode="membership_matrix",
            can_upgrade_pit_readiness=True,
            pit_notes=("Historical component matrix decides PIT membership only; it does not provide price evidence.",),
        ),
        _definition(
            "kaggle_huge_stock_market_dataset",
            "Kaggle Huge Stock Market Dataset",
            "free_account",
            ("price_history", "bulk_adjusted_ohlcv", "delisted_price_history"),
            fallback_order={"price_history": 7, "bulk_adjusted_ohlcv": 1, "delisted_price_history": 1},
            required_env_vars=("KAGGLE_API_TOKEN",),
            pit_mode="price_only",
            can_upgrade_pit_readiness=True,
            pit_notes=("Kaggle bulk cache can repair adjusted price evidence but cannot certify corporate actions.",),
        ),
        _definition(
            "kaggle_delisted_bulk_archive",
            "Kaggle Delisted Bulk Archive",
            "free_account",
            ("price_history", "delisted_price_history"),
            fallback_order={"price_history": 8, "delisted_price_history": 2},
            required_env_vars=("KAGGLE_API_TOKEN",),
            pit_mode="price_only",
            can_upgrade_pit_readiness=True,
            pit_notes=("Delisted archive rows are price evidence only unless a dataset manifest declares formal action events.",),
        ),
        _definition(
            "polygon",
            "Polygon.io",
            "paid_optional",
            ("price_history", "corporate_actions", "identity", "targeted_price_repair"),
            fallback_order={
                "price_history": 11,
                "corporate_actions": 9,
                "identity": 5,
                "targeted_price_repair": 3,
            },
            required_env_vars=("POLYGON_API_KEY",),
            optional_layer="paid_external",
            pit_mode="precision_evidence_source",
            can_upgrade_pit_readiness=True,
            pit_notes=("Polygon precision repair is gated by POLYGON_API_KEY and should be reserved for critical gaps.",),
        ),
        _definition(
            "fmp",
            "Financial Modeling Prep",
            "paid_optional",
            ("price_history", "identity"),
            fallback_order={"price_history": 7, "identity": 3},
            required_env_vars=("FMP_API_KEY",),
        ),
        _definition(
            "fmp_historical_constituent",
            "FMP Historical Constituents",
            "paid_optional",
            ("universe_history",),
            fallback_order={"universe_history": 1},
            required_env_vars=("FMP_API_KEY",),
        ),
        _definition(
            "alpha_vantage",
            "Alpha Vantage",
            "free_account",
            ("corporate_actions", "identity", "targeted_price_repair"),
            fallback_order={"corporate_actions": 4, "identity": 4, "targeted_price_repair": 1},
            required_env_vars=("ALPHAVANTAGE_API_KEY",),
        ),
        _definition(
            "sec_edgar",
            "SEC EDGAR",
            "free_account",
            ("corporate_actions",),
            fallback_order={"corporate_actions": 5},
        ),
        _definition(
            "wikipedia_revision_history",
            "Wikipedia Revision History",
            "public",
            ("universe_history",),
            fallback_order={"universe_history": 2},
        ),
        _definition(
            "wikipedia_current_page",
            "Wikipedia Current Constituents",
            "public",
            ("universe_current_fallback",),
            fallback_order={"universe_current_fallback": 1},
            pit_mode="current_fallback",
            can_upgrade_pit_readiness=False,
            pit_notes=("Current-page membership can diagnose gaps but cannot make a PIT universe READY.",),
        ),
        _definition(
            "official_announcement",
            "Official Index Announcements",
            "public",
            ("universe_history",),
            fallback_order={"universe_history": 3},
        ),
        _definition(
            "static_seed",
            "Static Seed",
            "public",
            ("universe_current_fallback",),
            fallback_order={"universe_current_fallback": 2},
            pit_mode="fallback_only",
            can_upgrade_pit_readiness=False,
            pit_notes=("Static/current fallback rows cannot upgrade historical PIT readiness.",),
        ),
        _definition(
            "us_treasury_xml",
            "US Treasury XML",
            "public",
            ("bond_fixed_income",),
            fallback_order={"bond_fixed_income": 1},
        ),
        _definition(
            "blackrock_ishares_official",
            "BlackRock iShares Official",
            "public",
            ("bond_fixed_income",),
            fallback_order={"bond_fixed_income": 2},
        ),
        _definition(
            "openbb_yfinance",
            "OpenBB yfinance",
            "public",
            ("price_history", "corporate_actions"),
            fallback_order={"price_history": 8, "corporate_actions": 6},
            optional_layer="openbb",
        ),
        _definition(
            "openbb_tiingo",
            "OpenBB Tiingo",
            "free_account",
            ("price_history", "corporate_actions"),
            fallback_order={"price_history": 9, "corporate_actions": 7},
            required_env_vars=("TIINGO_API_TOKEN",),
            optional_layer="openbb",
        ),
        _definition(
            "openbb_fmp",
            "OpenBB FMP",
            "paid_optional",
            ("price_history", "corporate_actions"),
            fallback_order={"price_history": 10, "corporate_actions": 8},
            required_env_vars=("FMP_API_KEY",),
            optional_layer="openbb",
        ),
        _definition(
            "openbb_alpha_vantage",
            "OpenBB Alpha Vantage",
            "free_account",
            ("targeted_price_repair",),
            fallback_order={"targeted_price_repair": 2},
            required_env_vars=("ALPHAVANTAGE_API_KEY",),
            optional_layer="openbb",
        ),
        _definition(
            "openbb_bond_fixed_income",
            "OpenBB Bond Fixed Income",
            "public",
            ("bond_fixed_income",),
            fallback_order={"bond_fixed_income": 3},
            optional_layer="openbb",
        ),
        _definition(
            "openbb_federal_reserve",
            "OpenBB Federal Reserve",
            "public",
            ("bond_fixed_income",),
            fallback_order={"bond_fixed_income": 4},
            optional_layer="openbb",
        ),
        _definition(
            "openbb_fred",
            "OpenBB FRED",
            "free_account",
            ("bond_fixed_income",),
            fallback_order={"bond_fixed_income": 5},
            required_env_vars=("FRED_API_KEY",),
            optional_layer="openbb",
        ),
        _definition(
            "openbb_index_constituents",
            "OpenBB Current Index Constituents",
            "paid_optional",
            ("universe_current_constituents_auxiliary",),
            fallback_order={"universe_current_constituents_auxiliary": 1},
            required_env_vars=("FMP_API_KEY",),
            optional_layer="openbb",
            pit_mode="metadata_only",
            can_upgrade_pit_readiness=False,
            pit_notes=("Current constituents are auxiliary metadata only and cannot upgrade PIT readiness.",),
        ),
    )
}


def openbb_provider_enabled() -> bool:
    return str(os.getenv("GRIT_ENABLE_OPENBB_PROVIDER") or "").strip().lower() in OPENBB_ENABLE_VALUES


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _normalized_provider_id(value: Any) -> str:
    return str(value or "").strip().lower()


def _provider_name(provider: Any) -> str:
    return _normalized_provider_id(getattr(provider, "provider_name", provider.__class__.__name__))


def _public_source_name(provider_id: str) -> str:
    return " ".join(part.capitalize() for part in str(provider_id).replace("-", "_").split("_") if part)


def _metadata_for_provider(provider: Any) -> dict[str, Any]:
    metadata = getattr(provider, "metadata", None)
    return dict(metadata) if isinstance(metadata, Mapping) else {}


def _target_types_for_provider(provider: Any, provider_id: str) -> tuple[str, ...]:
    definition = PROVIDER_DEFINITIONS.get(provider_id)
    target_types = list(definition.target_types if definition else ())
    if callable(getattr(provider, "fetch_history", None)):
        target_types.append("price_history")
    if callable(getattr(provider, "fetch_corporate_actions", None)) or bool(getattr(provider, "supports_action_enrichment", False)):
        target_types.append("corporate_actions")
    if callable(getattr(provider, "resolve_identity", None)):
        target_types.append("identity")
    if callable(getattr(provider, "load_snapshots", None)):
        target_types.append("universe_history")
    if callable(getattr(provider, "fetch_snapshots", None)):
        target_types.append("bond_fixed_income")
    if callable(getattr(provider, "check_current_constituents", None)):
        target_types.append("universe_current_constituents_auxiliary")
    return tuple(dict.fromkeys(target_types))


def _runtime_provider_entries(market_data_provider: Any) -> dict[str, dict[str, Any]]:
    entries: dict[str, dict[str, Any]] = {}

    def register(provider: Any, target_type: str | None = None, order: int | None = None) -> None:
        if provider is None:
            return
        provider_id = _provider_name(provider)
        if not provider_id:
            return
        payload = entries.setdefault(
            provider_id,
            {
                "provider": provider,
                "target_types": set(),
                "fallback_order": {},
                "metadata": {},
            },
        )
        payload["metadata"].update(_metadata_for_provider(provider))
        inferred_targets = _target_types_for_provider(provider, provider_id)
        payload["target_types"].update(inferred_targets)
        if target_type:
            payload["target_types"].add(target_type)
            if order is not None:
                existing = payload["fallback_order"].get(target_type)
                payload["fallback_order"][target_type] = int(order if existing is None else min(existing, order))

    providers = list(getattr(market_data_provider, "providers", None) or [])
    if providers:
        for index, provider in enumerate(providers, start=1):
            register(provider, None, index)
    else:
        register(market_data_provider)

    for attr_name, target_type in (
        ("price_providers", "price_history"),
        ("corporate_action_providers", "corporate_actions"),
        ("identity_providers", "identity"),
        ("targeted_price_repair_providers", "targeted_price_repair"),
        ("universe_history_providers", "universe_history"),
    ):
        for index, provider in enumerate(getattr(market_data_provider, attr_name, None) or [], start=1):
            register(provider, target_type, index)

    register(getattr(market_data_provider, "bond_fixed_income_provider", None), "bond_fixed_income", 1)
    register(
        getattr(market_data_provider, "current_universe_constituent_checker", None),
        "universe_current_constituents_auxiliary",
        1,
    )
    return entries


def _credential_requirements(provider_id: str, definition: ProviderDefinition | None, metadata: Mapping[str, Any] | None) -> dict[str, Any]:
    if provider_id.startswith("kaggle_"):
        status = kaggle_credential_status()
        return {
            "required_env_vars": ["KAGGLE_API_TOKEN"],
            "alternative_methods": status.get("accepted_methods", []),
            "configured": bool(status.get("configured")),
            "configured_env_vars": [
                item
                for item in ("KAGGLE_API_TOKEN", "KAGGLE_USERNAME", "KAGGLE_KEY")
                if str(os.getenv(item) or "").strip()
            ],
            "missing_env_vars": [] if status.get("configured") else ["KAGGLE_API_TOKEN"],
            "credential_status": status.get("credential_status"),
            "secret_persistence": "disabled",
            "notes": status.get("notes", []),
        }
    if provider_id == "polygon":
        status = polygon_credential_status()
        return {
            "required_env_vars": ["POLYGON_API_KEY"],
            "configured": bool(status.get("configured")),
            "configured_env_vars": status.get("configured_env_vars", []),
            "missing_env_vars": status.get("missing_env_vars", []),
            "credential_status": status.get("credential_status"),
            "secret_persistence": "disabled",
        }
    required = list(definition.required_env_vars if definition else ())
    if isinstance(metadata, Mapping):
        required.extend(str(item) for item in (metadata.get("required_env_vars") or []) if str(item).strip())
    required = list(dict.fromkeys(required))
    configured = [name for name in required if str(os.getenv(name) or "").strip()]
    missing = [name for name in required if name not in configured]
    return {
        "required_env_vars": required,
        "configured": len(missing) == 0,
        "configured_env_vars": configured,
        "missing_env_vars": missing,
        "secret_persistence": "disabled",
        "notes": (
            ["OpenBB credentials are read from environment variables only."]
            if provider_id.startswith("openbb_")
            else []
        ),
    }


def _provider_credential_ready(item: Mapping[str, Any]) -> bool:
    requirements = item.get("credential_requirements")
    if not isinstance(requirements, Mapping):
        return True
    return bool(requirements.get("configured", True))


def _provider_usable(item: Mapping[str, Any]) -> bool:
    quota_cooldown = item.get("quota_cooldown")
    if not isinstance(quota_cooldown, Mapping):
        quota_cooldown = {}
    return (
        bool(item.get("enabled"))
        and _provider_credential_ready(item)
        and not bool(quota_cooldown.get("quota_limited"))
        and not bool(quota_cooldown.get("cooldown_active"))
    )


def _provider_readiness_status(
    *,
    enabled: bool,
    credential_ready: bool,
    quota_limited: bool,
    cooldown_active: bool,
) -> str:
    if not enabled:
        return "disabled"
    if not credential_ready:
        return "missing_credentials"
    if cooldown_active:
        return "cooldown"
    if quota_limited:
        return "quota_limited"
    return "usable"


def _infer_attempt_status(provider_payload: Mapping[str, Any], summary_payload: Mapping[str, Any]) -> str:
    explicit = str(provider_payload.get("status") or "").strip().lower()
    if explicit:
        return explicit
    provider_id = str(provider_payload.get("provider_id") or "")
    if provider_id in set(str(item) for item in (summary_payload.get("unavailable_providers") or [])):
        return "unavailable"
    if provider_id in set(str(item) for item in (summary_payload.get("skipped_providers") or [])):
        return "skipped"
    if bool(provider_payload.get("quota_limited")) or int(provider_payload.get("limited_symbols") or 0) > 0:
        return "limited"
    if int(provider_payload.get("failed_symbols") or 0) > 0 and int(provider_payload.get("succeeded_symbols") or 0) <= 0:
        return "failed"
    if int(provider_payload.get("empty_symbols") or 0) > 0 and int(provider_payload.get("succeeded_symbols") or 0) <= 0:
        return "empty"
    if (
        int(provider_payload.get("succeeded_symbols") or 0) > 0
        or int(provider_payload.get("landed_row_count") or 0) > 0
        or int(provider_payload.get("landed_symbol_count") or 0) > 0
        or int(provider_payload.get("landed_anchor_count") or 0) > 0
    ):
        return "succeeded"
    return "unknown"


def _selection_status(provider_payload: Mapping[str, Any]) -> str | None:
    explicit = str(provider_payload.get("selection_status") or "").strip()
    if explicit:
        return explicit
    if int(provider_payload.get("selected_primary_symbols") or 0) > 0 or int(provider_payload.get("selected_primary_anchors") or 0) > 0:
        return "selected_primary"
    if int(provider_payload.get("succeeded_not_selected_symbols") or 0) > 0:
        return "succeeded_not_selected"
    return None


def _first_reason(provider_payload: Mapping[str, Any]) -> str:
    reasons = provider_payload.get("reasons")
    if isinstance(reasons, str):
        return reasons.strip()
    if isinstance(reasons, SequenceABC):
        for item in reasons:
            value = str(item or "").strip()
            if value:
                return value
    return str(provider_payload.get("reason") or "").strip()


def _snapshot_target(snapshot_id: str, snapshot_kind: str) -> str:
    if snapshot_kind == "UNIVERSE":
        return "universe_history"
    if snapshot_id == "ds-corporate-actions":
        return "corporate_actions"
    if snapshot_id == "ds-index-valuations":
        return "index_valuations"
    if snapshot_id == "bond_fixed_income":
        return "bond_fixed_income"
    return "price_history"


def _pit_effect(provider_id: str, auxiliary_only: bool = False) -> dict[str, Any]:
    definition = PROVIDER_DEFINITIONS.get(provider_id)
    can_upgrade = bool(definition.can_upgrade_pit_readiness if definition else True)
    mode = str(definition.pit_mode if definition else "evidence_source")
    notes = list(definition.pit_notes if definition else ())
    if auxiliary_only:
        can_upgrade = False
        mode = "metadata_only"
        if not notes:
            notes = ["Auxiliary metadata cannot upgrade PIT readiness."]
    return {
        "mode": mode,
        "can_upgrade_pit_readiness": can_upgrade,
        "notes": notes,
    }


def _source_governance(provider_id: str) -> dict[str, Any]:
    payload = dict(SOURCE_GOVERNANCE.get(provider_id) or {})
    if not payload:
        return {}
    payload.setdefault("secret_persistence", "disabled")
    return payload


def _stable_attempt_id(parts: Sequence[Any]) -> str:
    joined = "|".join(str(part or "") for part in parts)
    return "spa_" + hashlib.sha1(joined.encode("utf-8")).hexdigest()[:16]


def _attempt_from_provider_summary(
    *,
    provider_id: str,
    provider_payload: Mapping[str, Any],
    summary_payload: Mapping[str, Any],
    snapshot_kind: str,
    snapshot_id: str,
    job_id: str | None,
    attempted_at: str | None,
    source: str,
) -> dict[str, Any]:
    payload = dict(provider_payload)
    payload["provider_id"] = provider_id
    auxiliary_only = bool(payload.get("auxiliary_only"))
    status = _infer_attempt_status(payload, summary_payload)
    target_type = (
        "universe_current_constituents_auxiliary"
        if auxiliary_only or provider_id == "openbb_index_constituents"
        else _snapshot_target(snapshot_id, snapshot_kind)
    )
    reason = _first_reason(payload)
    error = str(payload.get("error") or "").strip()
    quota_limited = bool(payload.get("quota_limited")) or status == "limited"
    next_retry_at = payload.get("next_retry_at")
    return {
        "attempt_id": _stable_attempt_id(
            [provider_id, target_type, snapshot_kind, snapshot_id, job_id, attempted_at, status, source]
        ),
        "provider_id": provider_id,
        "target_type": target_type,
        "snapshot_kind": snapshot_kind,
        "snapshot_id": snapshot_id,
        "job_id": job_id,
        "status": status,
        "selection_status": _selection_status(payload),
        "access_tier": str(payload.get("access_tier") or provider_access_tier(provider_id)),
        "attempted_at": attempted_at,
        "next_retry_at": str(next_retry_at) if next_retry_at else None,
        "quota_limited": quota_limited,
        "cooldown_active": bool(quota_limited and next_retry_at),
        "reason": reason or None,
        "error": error or (reason if status in {"failed", "unavailable"} and reason else None),
        "landed_row_count": int(payload.get("landed_row_count") or 0),
        "landed_symbol_count": int(
            payload.get("landed_symbol_count")
            or payload.get("current_member_count")
            or payload.get("matched_latest_anchor_count")
            or 0
        ),
        "auxiliary_only": auxiliary_only,
        "pit_effect": _pit_effect(provider_id, auxiliary_only),
    }


def _iter_provider_summary_attempts(
    *,
    snapshots: Sequence[Mapping[str, Any]],
    snapshot_kind: str,
    job_id: str | None = None,
    attempted_at: str | None = None,
    source: str,
) -> list[dict[str, Any]]:
    attempts: list[dict[str, Any]] = []
    for snapshot in snapshots:
        snapshot_id = str(snapshot.get("id") or "")
        metadata = snapshot.get("metadata") if isinstance(snapshot.get("metadata"), Mapping) else {}
        provider_summary = (metadata or {}).get("provider_summary")
        if not isinstance(provider_summary, Mapping):
            continue
        providers = provider_summary.get("providers")
        if not isinstance(providers, Mapping):
            continue
        snapshot_attempted_at = attempted_at or str(snapshot.get("updated_at") or snapshot.get("as_of") or "") or None
        for provider_id, provider_payload in providers.items():
            if not isinstance(provider_payload, Mapping):
                continue
            attempts.append(
                _attempt_from_provider_summary(
                    provider_id=str(provider_id),
                    provider_payload=provider_payload,
                    summary_payload=provider_summary,
                    snapshot_kind=snapshot_kind,
                    snapshot_id=snapshot_id,
                    job_id=job_id,
                    attempted_at=snapshot_attempted_at,
                    source=source,
                )
            )
    return attempts


def _iter_refresh_stats_attempts(latest_job: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(latest_job, Mapping):
        return []
    job_id = str(latest_job.get("id") or "") or None
    attempted_at = str(latest_job.get("completed_at") or latest_job.get("updated_at") or latest_job.get("started_at") or "") or None
    summary = latest_job.get("summary") if isinstance(latest_job.get("summary"), Mapping) else {}
    refresh_stats = (summary or {}).get("refresh_stats")
    if not isinstance(refresh_stats, Mapping):
        return []
    attempts: list[dict[str, Any]] = []
    for snapshot_kind, group_key in (("DATASET", "datasets"), ("UNIVERSE", "universes")):
        group = refresh_stats.get(group_key)
        if not isinstance(group, Mapping):
            continue
        for snapshot_id, snapshot_payload in group.items():
            if not isinstance(snapshot_payload, Mapping):
                continue
            provider_summary = snapshot_payload.get("provider_summary")
            if not isinstance(provider_summary, Mapping):
                continue
            for provider_id, provider_payload in (provider_summary.get("providers") or {}).items():
                if not isinstance(provider_payload, Mapping):
                    continue
                attempts.append(
                    _attempt_from_provider_summary(
                        provider_id=str(provider_id),
                        provider_payload=provider_payload,
                        summary_payload=provider_summary,
                        snapshot_kind=snapshot_kind,
                        snapshot_id=str(snapshot_id),
                        job_id=job_id,
                        attempted_at=attempted_at,
                        source="latest_job",
                    )
                )
    bond = refresh_stats.get("bond_fixed_income")
    if isinstance(bond, Mapping):
        for item in bond.get("provider_results") or []:
            if not isinstance(item, Mapping):
                continue
            provider_id = str(item.get("provider") or "").strip()
            if not provider_id:
                continue
            attempts.append(
                _attempt_from_provider_summary(
                    provider_id=provider_id,
                    provider_payload=item,
                    summary_payload={},
                    snapshot_kind="DATASET",
                    snapshot_id="bond_fixed_income",
                    job_id=job_id,
                    attempted_at=attempted_at,
                    source="latest_job",
                )
            )
    return attempts


def build_provider_attempts(
    *,
    dataset_snapshots: Sequence[Mapping[str, Any]],
    universe_snapshots: Sequence[Mapping[str, Any]],
    latest_job: Mapping[str, Any] | None,
    limit: int = 100,
    provider_id: str | None = None,
    target_type: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    bounded_limit = max(1, min(int(limit or 100), 500))
    attempts = [
        *_iter_refresh_stats_attempts(latest_job),
        *_iter_provider_summary_attempts(
            snapshots=dataset_snapshots,
            snapshot_kind="DATASET",
            job_id=None,
            source="snapshot_metadata",
        ),
        *_iter_provider_summary_attempts(
            snapshots=universe_snapshots,
            snapshot_kind="UNIVERSE",
            job_id=None,
            source="snapshot_metadata",
        ),
    ]
    provider_filter = _normalized_provider_id(provider_id)
    target_filter = str(target_type or "").strip().lower()
    status_filter = str(status or "").strip().lower()
    if provider_filter:
        attempts = [item for item in attempts if _normalized_provider_id(item.get("provider_id")) == provider_filter]
    if target_filter:
        attempts = [item for item in attempts if str(item.get("target_type") or "").lower() == target_filter]
    if status_filter:
        attempts = [item for item in attempts if str(item.get("status") or "").lower() == status_filter]
    attempts = sorted(
        attempts,
        key=lambda item: (
            str(item.get("attempted_at") or ""),
            str(item.get("job_id") or ""),
            str(item.get("provider_id") or ""),
            str(item.get("snapshot_id") or ""),
        ),
        reverse=True,
    )
    return {
        "generated_at": _utc_now(),
        "latest_job_id": str((latest_job or {}).get("id") or "") or None,
        "items": attempts[:bounded_limit],
        "rollup": build_provider_attempt_rollup(
            attempts,
            latest_job_id=str((latest_job or {}).get("id") or "") or None,
        ),
    }


def build_provider_attempt_rollup(
    attempt_items: Sequence[Mapping[str, Any]],
    *,
    latest_job_id: str | None = None,
) -> dict[str, Any]:
    latest_job_key = str(latest_job_id or "").strip()
    latest_job_events = [
        item for item in attempt_items if latest_job_key and str(item.get("job_id") or "") == latest_job_key
    ]
    provider_ids = sorted(
        {
            _normalized_provider_id(item.get("provider_id"))
            for item in attempt_items
            if _normalized_provider_id(item.get("provider_id"))
        }
    )

    def sort_key(item: Mapping[str, Any]) -> tuple[int, str, str, str]:
        is_latest_job = latest_job_key and str(item.get("job_id") or "") == latest_job_key
        return (
            1 if is_latest_job else 0,
            str(item.get("attempted_at") or ""),
            str(item.get("snapshot_id") or ""),
            str(item.get("target_type") or ""),
        )

    provider_rows: list[dict[str, Any]] = []
    for provider_id in provider_ids:
        provider_events = [
            item for item in attempt_items if _normalized_provider_id(item.get("provider_id")) == provider_id
        ]
        latest_provider_events = [
            item for item in provider_events if latest_job_key and str(item.get("job_id") or "") == latest_job_key
        ]
        selected_events = latest_provider_events or provider_events
        representative = max(selected_events, key=sort_key) if selected_events else {}
        status_counts: dict[str, int] = {}
        for event in selected_events:
            status = str(event.get("status") or "unknown").strip().lower() or "unknown"
            status_counts[status] = status_counts.get(status, 0) + 1
        provider_rows.append(
            {
                "provider_id": provider_id,
                "selected_from": "latest_job" if latest_provider_events else "latest_available_attempt",
                "selection_reason": (
                    "latest_job_priority"
                    if latest_provider_events
                    else "no_latest_job_attempt_for_provider"
                ),
                "event_count": len(provider_events),
                "selected_event_count": len(selected_events),
                "latest_job_event_count": len(latest_provider_events),
                "target_types": sorted(
                    {
                        str(event.get("target_type") or "").strip()
                        for event in selected_events
                        if str(event.get("target_type") or "").strip()
                    }
                ),
                "status_counts": dict(sorted(status_counts.items())),
                "status": representative.get("status"),
                "attempted_at": representative.get("attempted_at"),
                "job_id": representative.get("job_id"),
                "quota_limited": any(bool(event.get("quota_limited")) for event in selected_events),
                "cooldown_active": any(bool(event.get("cooldown_active")) for event in selected_events),
                "auxiliary_only": any(bool(event.get("auxiliary_only")) for event in selected_events),
                "landed_row_count": sum(int(event.get("landed_row_count") or 0) for event in selected_events),
                "landed_symbol_count": sum(int(event.get("landed_symbol_count") or 0) for event in selected_events),
            }
        )

    latest_job_provider_ids = {
        _normalized_provider_id(item.get("provider_id"))
        for item in latest_job_events
        if _normalized_provider_id(item.get("provider_id"))
    }
    return {
        "policy": ATTEMPT_ROLLUP_POLICY,
        "latest_job_id": latest_job_key or None,
        "event_count": len(attempt_items),
        "unique_provider_count": len(provider_ids),
        "latest_job_event_count": len(latest_job_events),
        "latest_job_unique_provider_count": len(latest_job_provider_ids),
        "providers": provider_rows,
    }


def _latest_attempt_by_provider(attempt_items: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[Mapping[str, Any]]] = {}
    for attempt in attempt_items:
        provider_id = _normalized_provider_id(attempt.get("provider_id"))
        if provider_id:
            grouped.setdefault(provider_id, []).append(attempt)

    def sort_key(item: Mapping[str, Any]) -> tuple[int, str, str, str]:
        return (
            1 if str(item.get("job_id") or "").strip() else 0,
            str(item.get("attempted_at") or ""),
            str(item.get("snapshot_id") or ""),
            str(item.get("target_type") or ""),
        )

    return {
        provider_id: dict(max(items, key=sort_key))
        for provider_id, items in grouped.items()
        if items
    }


def build_provider_registry(
    *,
    market_data_provider: Any,
    attempt_items: Sequence[Mapping[str, Any]],
    openbb_enabled: bool | None = None,
) -> dict[str, Any]:
    enabled_openbb = openbb_provider_enabled() if openbb_enabled is None else bool(openbb_enabled)
    runtime_entries = _runtime_provider_entries(market_data_provider)
    runtime_provider_ids = set(runtime_entries.keys())
    missing_provider_reasons = {
        _normalized_provider_id(provider_id): str(reason)
        for provider_id, reason in dict(getattr(market_data_provider, "missing_provider_reasons", {}) or {}).items()
        if _normalized_provider_id(provider_id)
    }
    missing_provider_ids = {
        _normalized_provider_id(provider_id)
        for provider_id in (getattr(market_data_provider, "missing_providers", None) or [])
        if _normalized_provider_id(provider_id)
    }
    latest_attempts = _latest_attempt_by_provider(attempt_items)
    provider_ids = sorted(set(PROVIDER_DEFINITIONS) | runtime_provider_ids | missing_provider_ids | set(latest_attempts))
    items: list[dict[str, Any]] = []
    for provider_id in provider_ids:
        definition = PROVIDER_DEFINITIONS.get(provider_id)
        runtime_payload = runtime_entries.get(provider_id) or {}
        runtime_metadata = runtime_payload.get("metadata") if isinstance(runtime_payload.get("metadata"), Mapping) else {}
        optional_layer = definition.optional_layer if definition else None
        is_openbb = optional_layer == "openbb" or provider_id.startswith("openbb_")
        enabled = provider_id in runtime_provider_ids and provider_id not in missing_provider_ids
        if is_openbb and not enabled_openbb:
            enabled = False
        fallback_order = dict(definition.fallback_order if definition else ())
        fallback_order.update(dict(runtime_payload.get("fallback_order") or {}))
        target_types = list(definition.target_types if definition else ())
        target_types.extend(str(item) for item in (runtime_payload.get("target_types") or []) if str(item).strip())
        if provider_id in latest_attempts:
            target_types.append(str(latest_attempts[provider_id].get("target_type") or ""))
        target_types = list(dict.fromkeys(item for item in target_types if item))
        access_tier = str(
            (runtime_metadata or {}).get("access_tier")
            or (definition.access_tier if definition else provider_access_tier(provider_id))
        )
        credential_requirements = _credential_requirements(provider_id, definition, runtime_metadata)
        latest_attempt = latest_attempts.get(provider_id)
        quota_cooldown = {
            "quota_limited": bool((latest_attempt or {}).get("quota_limited")),
            "cooldown_active": bool((latest_attempt or {}).get("cooldown_active")),
            "next_retry_at": (latest_attempt or {}).get("next_retry_at"),
        }
        missing_reason = missing_provider_reasons.get(provider_id)
        error_summary = {
            "status": "missing_provider" if provider_id in missing_provider_ids else (latest_attempt or {}).get("status"),
            "reason": missing_reason or (latest_attempt or {}).get("reason"),
            "error": missing_reason or (latest_attempt or {}).get("error"),
        }
        credential_ready = bool(credential_requirements.get("configured"))
        usable = (
            enabled
            and credential_ready
            and not bool(quota_cooldown.get("quota_limited"))
            and not bool(quota_cooldown.get("cooldown_active"))
        )
        items.append(
            {
                "provider_id": provider_id,
                "source_name": definition.source_name if definition else _public_source_name(provider_id),
                "access_tier": access_tier,
                "credential_requirements": credential_requirements,
                "target_types": target_types,
                "fallback_order": fallback_order,
                "latest_attempt": (
                    {
                        "status": latest_attempt.get("status"),
                        "target_type": latest_attempt.get("target_type"),
                        "snapshot_id": latest_attempt.get("snapshot_id"),
                        "job_id": latest_attempt.get("job_id"),
                        "attempted_at": latest_attempt.get("attempted_at"),
                    }
                    if latest_attempt
                    else None
                ),
                "quota_cooldown": quota_cooldown,
                "error_summary": error_summary,
                "pit_permission": _pit_effect(provider_id, bool((latest_attempt or {}).get("auxiliary_only"))),
                "source_governance": _source_governance(provider_id),
                "enabled": enabled,
                "credential_ready": credential_ready,
                "usable": usable,
                "readiness_status": _provider_readiness_status(
                    enabled=enabled,
                    credential_ready=credential_ready,
                    quota_limited=bool(quota_cooldown.get("quota_limited")),
                    cooldown_active=bool(quota_cooldown.get("cooldown_active")),
                ),
                "optional_layer": optional_layer,
            }
        )
    return {
        "generated_at": _utc_now(),
        "openbb_enabled": enabled_openbb,
        "items": items,
    }


def build_provider_readiness_summary(
    *,
    registry_items: Sequence[Mapping[str, Any]],
    attempt_items: Sequence[Mapping[str, Any]],
    openbb_enabled: bool | None = None,
    attempt_rollup: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    enabled_openbb = openbb_provider_enabled() if openbb_enabled is None else bool(openbb_enabled)
    target_type_counts: dict[str, int] = {}
    for item in registry_items:
        for target_type in item.get("target_types") or []:
            target_key = str(target_type or "").strip()
            if target_key:
                target_type_counts[target_key] = target_type_counts.get(target_key, 0) + 1
    attempted_provider_ids = {_normalized_provider_id(item.get("provider_id")) for item in attempt_items if item.get("provider_id")}
    quota_provider_ids = {_normalized_provider_id(item.get("provider_id")) for item in attempt_items if item.get("quota_limited")}
    cooldown_provider_ids = {_normalized_provider_id(item.get("provider_id")) for item in attempt_items if item.get("cooldown_active")}
    failed_provider_ids = {
        _normalized_provider_id(item.get("provider_id"))
        for item in attempt_items
        if str(item.get("status") or "").lower() in {"failed", "unavailable", "limited"}
    }
    auxiliary_provider_ids = {_normalized_provider_id(item.get("provider_id")) for item in attempt_items if item.get("auxiliary_only")}
    current_scope_registry_items = [
        item
        for item in registry_items
        if not (
            str(item.get("provider_id") or "").startswith("openbb_")
            and not enabled_openbb
        )
    ]
    credential_ready_provider_ids = {
        _normalized_provider_id(item.get("provider_id"))
        for item in current_scope_registry_items
        if _provider_credential_ready(item)
    }
    usable_provider_ids = {
        _normalized_provider_id(item.get("provider_id"))
        for item in current_scope_registry_items
        if _provider_usable(item)
    }

    def counts_as_current_credential_blocker(item: Mapping[str, Any]) -> bool:
        provider_id = str(item.get("provider_id") or "")
        if provider_id.startswith("openbb_") and not enabled_openbb:
            return False
        return bool((item.get("credential_requirements") or {}).get("missing_env_vars"))

    missing_credential_provider_ids = {
        _normalized_provider_id(item.get("provider_id"))
        for item in registry_items
        if counts_as_current_credential_blocker(item)
    }
    top_blockers: list[dict[str, Any]] = []
    for item in registry_items:
        provider_id = str(item.get("provider_id") or "")
        missing_env = list((item.get("credential_requirements") or {}).get("missing_env_vars") or [])
        if missing_env and counts_as_current_credential_blocker(item):
            top_blockers.append(
                {
                    "provider_id": provider_id,
                    "code": "missing_credentials",
                    "message": "Required provider environment variables are missing.",
                    "target": missing_env,
                }
            )
    for attempt in attempt_items:
        status = str(attempt.get("status") or "").lower()
        if status not in {"failed", "unavailable", "limited"} and not attempt.get("cooldown_active"):
            continue
        top_blockers.append(
            {
                "provider_id": attempt.get("provider_id"),
                "code": "provider_cooldown" if attempt.get("cooldown_active") else f"provider_{status}",
                "message": attempt.get("error") or attempt.get("reason") or status,
                "target": attempt.get("target_type"),
            }
        )
    last_attempt_at = max(
        (str(item.get("attempted_at") or "") for item in attempt_items if item.get("attempted_at")),
        default=None,
    )
    openbb_items = [item for item in registry_items if str(item.get("provider_id") or "").startswith("openbb_")]
    openbb_attempts = [item for item in attempt_items if str(item.get("provider_id") or "").startswith("openbb_")]
    openbb_credential_ready_provider_ids = {
        _normalized_provider_id(item.get("provider_id"))
        for item in openbb_items
        if _provider_credential_ready(item)
    }
    openbb_usable_provider_ids = {
        _normalized_provider_id(item.get("provider_id"))
        for item in openbb_items
        if _provider_usable(item)
    }
    rollup = dict(attempt_rollup or {})
    latest_job_attempt_event_count = int(rollup.get("latest_job_event_count") or 0)
    latest_job_attempted_provider_count = int(rollup.get("latest_job_unique_provider_count") or 0)
    openbb_latest_job_attempts = [
        item
        for item in openbb_attempts
        if str(item.get("job_id") or "") and str(item.get("job_id") or "") == str(rollup.get("latest_job_id") or "")
    ]
    return {
        "provider_count": len(registry_items),
        "registered_provider_count": len(registry_items),
        "enabled_provider_count": len([item for item in registry_items if item.get("enabled")]),
        "credential_ready_provider_count": len(credential_ready_provider_ids),
        "usable_provider_count": len(usable_provider_ids),
        "attempted_provider_count": len(attempted_provider_ids),
        "attempt_event_count": len(attempt_items),
        "unique_attempted_provider_count": len(attempted_provider_ids),
        "latest_job_attempt_event_count": latest_job_attempt_event_count,
        "latest_job_attempted_provider_count": latest_job_attempted_provider_count,
        "attempt_rollup_policy": str(rollup.get("policy") or ATTEMPT_ROLLUP_POLICY),
        "quota_limited_provider_count": len(quota_provider_ids),
        "cooldown_provider_count": len(cooldown_provider_ids),
        "missing_credential_provider_count": len(missing_credential_provider_ids),
        "failed_provider_count": len(failed_provider_ids),
        "auxiliary_only_provider_count": len(auxiliary_provider_ids),
        "target_type_counts": dict(sorted(target_type_counts.items())),
        "top_blockers": top_blockers[:5],
        "last_attempt_at": last_attempt_at,
        "openbb": {
            "enabled": enabled_openbb,
            "provider_count": len(openbb_items),
            "enabled_provider_count": len([item for item in openbb_items if item.get("enabled")]),
            "credential_ready_provider_count": 0 if not enabled_openbb else len(openbb_credential_ready_provider_ids),
            "usable_provider_count": 0 if not enabled_openbb else len(openbb_usable_provider_ids),
            "attempted_provider_count": len({_normalized_provider_id(item.get("provider_id")) for item in openbb_attempts}),
            "attempt_event_count": len(openbb_attempts),
            "latest_job_attempt_event_count": len(openbb_latest_job_attempts),
            "latest_job_attempted_provider_count": len(
                {_normalized_provider_id(item.get("provider_id")) for item in openbb_latest_job_attempts}
            ),
            "missing_credential_provider_count": 0
            if not enabled_openbb
            else len([item for item in openbb_items if (item.get("credential_requirements") or {}).get("missing_env_vars")]),
        },
    }

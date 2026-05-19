from __future__ import annotations

import csv
import json
import os
import shutil
import sys
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PIT_BULK_CACHE_DIR = PROJECT_ROOT / ".tmp" / "pit-bulk-cache"
PIT_EXTERNAL_SOURCE_MANIFEST_VERSION = "pit_external_sources_v1"
POLYGON_CRITICAL_CANDIDATE_LIMIT = 50
NESTED_CACHE_DIR_CANDIDATES = ("grit-pit-bulk-cache",)

KAGGLE_SEARCH_TERMS = [
    "survivorship bias free",
    "delisted",
    "US stock market historical data delisted",
    "EOD historical data stocks",
]

KAGGLE_DATASET_RECOMMENDATIONS = [
    {
        "dataset_id": "borismarjanovic/price-volume-data-for-all-us-stocks-etfs",
        "label": "Huge Stock Market Dataset",
        "source_url": "https://www.kaggle.com/datasets/borismarjanovic/price-volume-data-for-all-us-stocks-etfs",
        "target": "bulk_adjusted_ohlcv",
        "license": "CC0: Public Domain",
        "coverage_note": "历史日线 OHLCV，价格已按分红和拆股调整；适合补 2000-2017 主体退市价格缺口。",
        "pit_mode": "price_only",
    },
    {
        "dataset_id": "rodas86/arandkei-historical-delisted-assets-archive",
        "label": "Arandkei Historical Delisted Assets Archive",
        "source_url": "https://www.kaggle.com/datasets/rodas86/arandkei-historical-delisted-assets-archive",
        "target": "delisted_adjusted_ohlcv",
        "license": "verify_before_import",
        "coverage_note": "退市资产专项候选源；下载前必须记录 license、字段和覆盖年限。",
        "pit_mode": "price_only",
    },
]

PAID_DATASET_RECOMMENDATIONS = [
    {
        "provider_id": "crsp_us_stock",
        "label": "CRSP US Stock",
        "source_url": "https://www.crsp.org/crsp_pdf/crsp-us-stock-indexes-databases-data-descriptions-guide-crspaccess/",
        "target": "institutional_price_actions_delisting_returns",
        "required_env_vars": ["CRSP_DATA_PATH"],
        "coverage_note": "Licensed institutional source for prices, name history, delisting returns, and index membership. Best fit when L1 must reach 100% for old delisted constituents.",
        "pit_mode": "institutional_gold_source",
    },
    {
        "provider_id": "norgate_us_equities",
        "label": "Norgate US Equities",
        "source_url": "https://norgatedata.com/data-content-tables.php",
        "target": "survivorship_bias_free_us_equities",
        "required_env_vars": ["NORGATE_DATA_PATH"],
        "coverage_note": "Licensed local source for US delisted stocks and historical index constituents. Needs a manifest-checked export path.",
        "pit_mode": "survivorship_bias_free_bundle",
    },
    {
        "provider_id": "sharadar",
        "label": "Sharadar",
        "source_url": "https://www.sharadar.com/data",
        "target": "survivorship_bias_free_prices_fundamentals",
        "required_env_vars": ["NASDAQ_DATA_LINK_API_KEY"],
        "coverage_note": "Licensed bundle candidate for active and delisted US prices and fundamentals. Requires active Sharadar entitlement.",
        "pit_mode": "survivorship_bias_free_bundle",
    },
    {
        "provider_id": "eodhd",
        "label": "EODHD",
        "source_url": "https://eodhd.com/",
        "target": "delisted_prices_actions_fundamentals",
        "required_env_vars": ["EODHD_API_TOKEN"],
        "coverage_note": "API candidate for delisted symbols, EOD prices, splits/dividends, and fundamentals. Requires plan entitlement and old-symbol mapping.",
        "pit_mode": "paid_delisted_bundle",
    },
]

FREE_REPAIR_ROUTE_RECOMMENDATIONS = [
    {
        "provider_id": "alpha_vantage_delisted_list",
        "label": "Alpha Vantage Listing Status",
        "source_url": "https://www.alphavantage.co/documentation/#listing-status",
        "target": "delisted_symbol_identity",
        "required_env_vars": ["ALPHAVANTAGE_API_KEY"],
        "coverage_note": "Official CSV endpoint for active/delisted symbol lifecycle discovery; rate-limited and should only seed targeted repair queues.",
        "pit_mode": "identity_listing_seed",
    },
    {
        "provider_id": "stooq_online",
        "label": "Stooq Online CSV",
        "source_url": "https://stooq.com/q/d/l/",
        "target": "delisted_price_history",
        "required_env_vars": ["GRIT_ENABLE_STOOQ_ONLINE"],
        "coverage_note": "Public single-symbol daily CSV fallback for price-only repairs when the local Stooq archive misses an old ticker.",
        "pit_mode": "price_only",
    },
    {
        "provider_id": "yahoo_history_html",
        "label": "Yahoo Finance Historical Page",
        "source_url": "https://finance.yahoo.com/quote/{symbol}/history",
        "target": "last_resort_price_page_probe",
        "required_env_vars": ["GRIT_ENABLE_YAHOO_HTML_HISTORY"],
        "coverage_note": "Observation-only HTML page probe for old tickers when the chart endpoint returns 404. Use landed rows only when a parser extracts dated OHLCV rows; otherwise keep it as evidence.",
        "pit_mode": "html_probe_observation",
    },
    {
        "provider_id": "sec_edgar_8k",
        "label": "SEC EDGAR 8-K Filings",
        "source_url": "https://www.sec.gov/edgar/sec-api-documentation",
        "target": "corporate_action_lifecycle_filings",
        "required_env_vars": ["SEC_USER_AGENT"],
        "coverage_note": "Free lifecycle filing evidence for mergers, acquisitions, ticker changes, and other material events; not an OHLCV source.",
        "pit_mode": "filing_lifecycle_evidence",
    },
    {
        "provider_id": "sec_companyfacts_edgartools",
        "label": "SEC Companyfacts via Edgartools",
        "source_url": "https://edgartools.readthedocs.io/en/latest/guides/financial-data/",
        "target": "fundamentals",
        "required_env_vars": ["SEC_USER_AGENT", "EDGAR_LOCAL_DATA_DIR"],
        "coverage_note": "Python helper path over SEC companyfacts/XBRL; preserves filed-date PIT semantics when mapped through CIK aliases.",
        "pit_mode": "sec_companyfacts_helper",
    },
    {
        "provider_id": "openbb_sdk",
        "label": "OpenBB SDK Provider Chain",
        "source_url": "https://docs.openbb.co/odp/python/extensions/providers",
        "target": "provider_chain_probe",
        "required_env_vars": ["GRIT_ENABLE_OPENBB_PROVIDER"],
        "coverage_note": "Optional provider wrapper for yfinance/Tiingo/FMP/Alpha/SEC extensions. It does not host data and still depends on underlying provider keys.",
        "pit_mode": "optional_provider_wrapper",
    },
    {
        "provider_id": "iex_cloud_legacy",
        "label": "IEX Cloud Legacy/Sandbox",
        "source_url": "https://iexcloud.org/",
        "target": "legacy_observation",
        "required_env_vars": ["IEX_TOKEN or IEX_CLOUD_TOKEN"],
        "coverage_note": "Observation-only because IEX Cloud API products were retired in 2024; do not rely on it for L1/L2 readiness.",
        "pit_mode": "sandbox_observation",
    },
]

MATRIX_SOURCE_RECOMMENDATIONS = [
    {
        "provider_id": "github_sp500_historical_components",
        "label": "fja05680/sp500",
        "source_url": "https://github.com/fja05680/sp500",
        "target": "sp500_historical_components",
        "coverage_note": "S&P 500 historical components matrix，用作历史成员骨架而不是价格源。",
    },
]


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def default_cache_dir() -> Path:
    return Path(os.getenv("GRIT_PIT_BULK_CACHE_DIR") or DEFAULT_PIT_BULK_CACHE_DIR)


def _cache_dir_has_artifacts(path: Path) -> bool:
    if (path / "manifest.json").is_file():
        return True
    if (path / "catalog" / "gsl_pit_bulk.duckdb").is_file():
        return True
    manifest_dir = path / "manifests"
    if manifest_dir.exists() and any(manifest_dir.glob("*.json")):
        return True
    normalized_dir = path / "normalized"
    return normalized_dir.exists() and any(normalized_dir.rglob("*.parquet"))


def resolve_cache_dir(cache_dir: str | Path | None = None) -> Path:
    root = Path(cache_dir) if cache_dir else default_cache_dir()
    if _cache_dir_has_artifacts(root):
        return root
    for dirname in NESTED_CACHE_DIR_CANDIDATES:
        candidate = root / dirname
        if _cache_dir_has_artifacts(candidate):
            return candidate
    return root


def _existing_kaggle_paths() -> list[str]:
    candidates: list[Path] = []
    config_dir = os.getenv("KAGGLE_CONFIG_DIR")
    if config_dir:
        base = Path(config_dir)
        candidates.extend([base / "access_token", base / "kaggle.json"])
    home = Path.home()
    candidates.extend([home / ".kaggle" / "access_token", home / ".kaggle" / "kaggle.json"])
    return [str(path) for path in candidates if path.exists() and path.is_file()]


def _classify_secret_value(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        return "missing"
    if stripped.startswith("<") and stripped.endswith(">"):
        return "invalid_placeholder_wrapped"
    if " " in stripped or "\n" in stripped or "\r" in stripped:
        return "invalid_format"
    return "present"


def _classify_sec_user_agent(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        return "missing"
    if stripped.startswith("<") and stripped.endswith(">"):
        return "invalid_placeholder_wrapped"
    return "present" if "@" in stripped else "invalid_missing_contact_email"


def kaggle_credential_status() -> dict[str, Any]:
    api_token_status = _classify_secret_value(str(os.getenv("KAGGLE_API_TOKEN") or ""))
    username_status = _classify_secret_value(str(os.getenv("KAGGLE_USERNAME") or ""))
    key_status = _classify_secret_value(str(os.getenv("KAGGLE_KEY") or ""))
    has_api_token = api_token_status == "present"
    has_legacy_env = username_status == "present" and key_status == "present"
    existing_files = _existing_kaggle_paths()
    configured = has_api_token or has_legacy_env or bool(existing_files)
    invalid_reasons = [
        reason
        for reason in {
            "KAGGLE_API_TOKEN": api_token_status,
            "KAGGLE_USERNAME": username_status,
            "KAGGLE_KEY": key_status,
        }.values()
        if reason.startswith("invalid_")
    ]
    credential_status = "invalid" if invalid_reasons else ("present" if configured else "missing")
    return {
        "configured": configured,
        "credential_status": credential_status,
        "accepted_methods": [
            "KAGGLE_API_TOKEN",
            "~/.kaggle/access_token",
            "legacy KAGGLE_USERNAME + KAGGLE_KEY",
            "legacy ~/.kaggle/kaggle.json",
        ],
        "configured_methods": [
            method
            for method, present in (
                ("KAGGLE_API_TOKEN", has_api_token),
                ("KAGGLE_USERNAME+KAGGLE_KEY", has_legacy_env),
                ("kaggle_token_file", bool(existing_files)),
            )
            if present
        ],
        "invalid_reasons": sorted(set(invalid_reasons)),
        "credential_files_present": existing_files,
        "secret_persistence": "disabled",
        "notes": [
            "Do not store Kaggle tokens in the repository, logs, screenshots, SQLite payloads, or manifests.",
            "If a token was pasted into chat or logs, revoke it and generate a new token before running downloads.",
        ],
    }


def polygon_credential_status() -> dict[str, Any]:
    accepted_env_vars = ["MASSIVE_API_KEY"]
    configured_env_vars = [name for name in accepted_env_vars if str(os.getenv(name) or "").strip()]
    configured = bool(configured_env_vars)
    return {
        "configured": configured,
        "credential_status": "present" if configured else "missing",
        "required_env_vars": accepted_env_vars,
        "accepted_env_vars": accepted_env_vars,
        "configured_env_vars": configured_env_vars,
        "missing_env_vars": [] if configured else accepted_env_vars,
        "secret_persistence": "disabled",
    }


def eodhd_credential_status() -> dict[str, Any]:
    accepted_env_vars = ["EODHD_API_TOKEN", "EODHD_API_KEY"]
    configured_env_vars = [name for name in accepted_env_vars if str(os.getenv(name) or "").strip()]
    configured = bool(configured_env_vars)
    return {
        "configured": configured,
        "credential_status": "present" if configured else "missing",
        "required_env_vars": ["EODHD_API_TOKEN"],
        "accepted_env_vars": accepted_env_vars,
        "configured_env_vars": configured_env_vars,
        "missing_env_vars": [] if configured else ["EODHD_API_TOKEN"],
        "secret_persistence": "disabled",
        "delisted_symbol_pattern": "{symbol}_old.US",
    }


def free_repair_route_status() -> dict[str, Any]:
    sec_user_agent = _classify_sec_user_agent(str(os.getenv("SEC_USER_AGENT") or ""))
    alpha_vantage = _classify_secret_value(str(os.getenv("ALPHAVANTAGE_API_KEY") or ""))
    stooq_online = str(os.getenv("GRIT_ENABLE_STOOQ_ONLINE") or "").strip().lower() in {"1", "true", "yes", "on"}
    yahoo_html_enabled = str(os.getenv("GRIT_ENABLE_YAHOO_HTML_HISTORY") or "").strip().lower() in {"1", "true", "yes", "on"}
    openbb_enabled = str(os.getenv("GRIT_ENABLE_OPENBB_PROVIDER") or "").strip().lower() in {"1", "true", "yes", "on"}
    iex_configured = bool(str(os.getenv("IEX_TOKEN") or "").strip() or str(os.getenv("IEX_CLOUD_TOKEN") or "").strip())
    edgar_cache_dir = str(os.getenv("EDGAR_LOCAL_DATA_DIR") or "").strip()
    return {
        "sec_user_agent": sec_user_agent,
        "alpha_vantage": alpha_vantage,
        "stooq_online_enabled": stooq_online,
        "yahoo_history_html_enabled": yahoo_html_enabled,
        "openbb_enabled": openbb_enabled,
        "iex_legacy_token_configured": iex_configured,
        "edgar_local_data_dir_configured": bool(edgar_cache_dir),
        "edgar_local_data_dir": edgar_cache_dir or None,
        "python_packages": {
            "edgar": _optional_import_status("edgar"),
            "openbb": _optional_import_status("openbb"),
            "openbb_yfinance": _optional_import_status("openbb_yfinance"),
            "openbb_alpha_vantage": _optional_import_status("openbb_alpha_vantage"),
            "openbb_fmp": _optional_import_status("openbb_fmp"),
            "openbb_sec": _optional_import_status("openbb_sec"),
        },
        "recommendations": FREE_REPAIR_ROUTE_RECOMMENDATIONS,
        "secret_persistence": "disabled",
    }


def _safe_read_json(path: Path) -> dict[str, Any] | None:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    return payload if isinstance(payload, dict) else None


def load_external_source_manifests(cache_dir: str | Path | None = None) -> list[dict[str, Any]]:
    root = resolve_cache_dir(cache_dir)
    manifest_paths: list[Path] = []
    if (root / "manifest.json").exists():
        manifest_paths.append(root / "manifest.json")
    manifest_dir = root / "manifests"
    if manifest_dir.exists():
        manifest_paths.extend(sorted(manifest_dir.glob("*.json")))
    manifests: list[dict[str, Any]] = []
    for path in manifest_paths:
        payload = _safe_read_json(path)
        if not payload:
            continue
        payload.setdefault("manifest_path", str(path))
        manifests.append(payload)
    return manifests


def write_external_source_manifest(
    manifest: Mapping[str, Any],
    *,
    cache_dir: str | Path | None = None,
    manifest_id: str | None = None,
) -> Path:
    root = Path(cache_dir) if cache_dir else default_cache_dir()
    manifest_dir = root / "manifests"
    manifest_dir.mkdir(parents=True, exist_ok=True)
    identifier = str(manifest_id or manifest.get("manifest_id") or f"manifest-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}")
    safe_identifier = "".join(ch if ch.isalnum() or ch in {"-", "_", "."} else "-" for ch in identifier)
    path = manifest_dir / f"{safe_identifier}.json"
    payload = {
        "manifest_version": PIT_EXTERNAL_SOURCE_MANIFEST_VERSION,
        "generated_at": utc_now(),
        **dict(manifest),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    return path


def _manifest_kind(manifest: Mapping[str, Any]) -> str:
    return str(manifest.get("source_kind") or manifest.get("kind") or manifest.get("target") or "").strip().lower()


def _manifest_dataset_id(manifest: Mapping[str, Any]) -> str:
    return str(manifest.get("dataset_id") or manifest.get("source_id") or manifest.get("provider_id") or "").strip()


def _build_cache_manifest_status(cache_dir: Path, manifests: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    kaggle_manifests = [
        dict(item)
        for item in manifests
        if "kaggle" in str(item.get("provider_id") or item.get("source") or item.get("source_kind") or "").lower()
        or str(item.get("dataset_id") or "").strip()
    ]
    return {
        "cache_dir": str(cache_dir),
        "status": "READY" if kaggle_manifests else "MISSING",
        "manifest_count": len(kaggle_manifests),
        "datasets": [
            {
                "dataset_id": _manifest_dataset_id(item),
                "source_url": item.get("source_url"),
                "license": item.get("license") or "unknown",
                "row_count": int(item.get("row_count") or 0),
                "schema_fingerprint": item.get("schema_fingerprint"),
                "manifest_path": item.get("manifest_path"),
                "last_imported_at": item.get("last_imported_at") or item.get("generated_at"),
                "pit_mode": item.get("pit_mode") or "price_only",
            }
            for item in kaggle_manifests
        ],
        "recommendations": KAGGLE_DATASET_RECOMMENDATIONS,
        "search_terms": KAGGLE_SEARCH_TERMS,
    }


def _build_matrix_status(manifests: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    matrix_manifests = [
        dict(item)
        for item in manifests
        if _manifest_kind(item) in {"matrix", "sp500_historical_components", "historical_components"}
        or str(item.get("provider_id") or "").strip() == "github_sp500_historical_components"
    ]
    latest = matrix_manifests[-1] if matrix_manifests else {}
    return {
        "status": "READY" if matrix_manifests else "MISSING",
        "source_count": len(matrix_manifests),
        "latest_source_url": latest.get("source_url"),
        "latest_revision_id": latest.get("source_revision_id") or latest.get("source_hash"),
        "effective_start": latest.get("effective_start"),
        "effective_end": latest.get("effective_end"),
        "member_event_count": int(latest.get("member_event_count") or latest.get("row_count") or 0),
        "recommendations": MATRIX_SOURCE_RECOMMENDATIONS,
        "requirement": "Matrix decides historical membership only; it does not replace price or corporate-action evidence.",
    }


def _build_parquet_catalog_status(cache_dir: Path, manifests: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    catalog_path = cache_dir / "catalog" / "gsl_pit_bulk.duckdb"
    normalized_dir = cache_dir / "normalized"
    parquet_count = len(list(normalized_dir.rglob("*.parquet"))) if normalized_dir.exists() else 0
    manifest_catalogs = [item for item in manifests if item.get("duckdb_catalog") or item.get("parquet_path")]
    manifest_row_count = sum(int(item.get("row_count") or 0) for item in manifest_catalogs)
    status = "READY" if parquet_count > 0 or manifest_row_count > 0 else "MISSING"
    return {
        "status": status,
        "duckdb_catalog": str(catalog_path),
        "catalog_exists": catalog_path.exists(),
        "normalized_dir": str(normalized_dir),
        "parquet_file_count": parquet_count,
        "manifest_catalog_count": len(manifest_catalogs),
        "manifest_row_count": manifest_row_count,
        "partitioning": "symbol_prefix + year",
    }


def _repair_queue(repair_plan: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    if not isinstance(repair_plan, Mapping):
        return []
    items = repair_plan.get("queue_sample")
    if not isinstance(items, Sequence) or isinstance(items, (str, bytes)):
        return []
    return [dict(item) for item in items if isinstance(item, Mapping)]


def _critical_polygon_candidates(repair_plan: Mapping[str, Any] | None, *, limit: int = POLYGON_CRITICAL_CANDIDATE_LIMIT) -> list[dict[str, Any]]:
    priority = {
        "historical_lifecycle_missing": 10,
        "corporate_action_alignment": 20,
        "current_core_missing": 30,
        "identity_unresolved": 40,
        "non_core_missing": 80,
    }
    candidates = []
    for item in _repair_queue(repair_plan):
        targets = [str(target) for target in (item.get("repair_targets") or [])]
        bucket = str(item.get("bucket") or "")
        if bucket not in priority and "corporate_actions" not in targets:
            continue
        candidates.append(
            {
                "symbol": str(item.get("symbol") or "").strip().upper(),
                "bucket": bucket,
                "repair_targets": targets,
                "priority": priority.get(bucket, int(item.get("priority") or 99)),
                "reason": "Polygon precision lane is reserved for critical delisted, lifecycle, or corporate-action gaps.",
            }
        )
    candidates = [item for item in candidates if item["symbol"]]
    candidates.sort(key=lambda item: (int(item["priority"]), str(item["symbol"])))
    return candidates[: max(1, int(limit))]


def _remaining_blockers_by_source(
    *,
    repair_plan: Mapping[str, Any] | None,
    matrix_ready: bool,
    kaggle_ready: bool,
    polygon_ready: bool,
) -> dict[str, Any]:
    queue = _repair_queue(repair_plan)
    bucket_counts: dict[str, int] = {}
    target_counts: dict[str, int] = {}
    for item in queue:
        bucket = str(item.get("bucket") or "unknown")
        bucket_counts[bucket] = bucket_counts.get(bucket, 0) + 1
        for target in item.get("repair_targets") or []:
            target_key = str(target or "").strip()
            if target_key:
                target_counts[target_key] = target_counts.get(target_key, 0) + 1
    return {
        "matrix": {
            "status": "READY" if matrix_ready else "MISSING",
            "blocked_buckets": {
                key: bucket_counts.get(key, 0)
                for key in ("historical_lifecycle_missing", "current_core_missing", "identity_unresolved")
            },
        },
        "kaggle_bulk": {
            "status": "READY" if kaggle_ready else "MISSING",
            "blocked_targets": {"price": target_counts.get("price", 0)},
            "note": "Kaggle bulk cache can repair price evidence but cannot certify corporate actions unless the dataset has formal events.",
        },
        "polygon_precision": {
            "status": "READY" if polygon_ready else "MISSING_CREDENTIAL",
            "blocked_targets": {
                "price": target_counts.get("price", 0),
                "corporate_actions": target_counts.get("corporate_actions", 0),
                "identity": target_counts.get("identity", 0),
            },
        },
    }


def build_external_source_readiness(
    *,
    repair_plan: Mapping[str, Any] | None = None,
    cache_dir: str | Path | None = None,
) -> dict[str, Any]:
    root = resolve_cache_dir(cache_dir)
    manifests = load_external_source_manifests(root)
    kaggle_auth = kaggle_credential_status()
    polygon_auth = polygon_credential_status()
    kaggle_cache = _build_cache_manifest_status(root, manifests)
    matrix_status = _build_matrix_status(manifests)
    parquet_catalog = _build_parquet_catalog_status(root, manifests)
    polygon_ready = bool(polygon_auth.get("configured"))
    critical_candidates = _critical_polygon_candidates(repair_plan)
    return {
        "generated_at": utc_now(),
        "cache_dir": str(root),
        "security_policy": {
            "secret_persistence": "disabled",
            "token_rotation_required_if_pasted": True,
            "redaction": "Only credential presence and environment variable names may be exposed.",
        },
        "kaggle_auth_status": kaggle_auth,
        "kaggle_cache_manifest": kaggle_cache,
        "matrix_coverage_status": matrix_status,
        "parquet_catalog_status": parquet_catalog,
        "polygon_status": {
            **polygon_auth,
            "enabled": polygon_ready,
            "critical_candidate_limit": POLYGON_CRITICAL_CANDIDATE_LIMIT,
            "target_types": ["price_history", "corporate_actions", "identity"],
        },
        "free_repair_routes": free_repair_route_status(),
        "eodhd_status": eodhd_credential_status(),
        "critical_polygon_candidates": critical_candidates,
        "remaining_blockers_by_source": _remaining_blockers_by_source(
            repair_plan=repair_plan,
            matrix_ready=matrix_status["status"] == "READY",
            kaggle_ready=kaggle_cache["status"] == "READY",
            polygon_ready=polygon_ready,
        ),
        "source_recommendations": {
            "search_terms": KAGGLE_SEARCH_TERMS,
            "kaggle": KAGGLE_DATASET_RECOMMENDATIONS,
            "matrix": MATRIX_SOURCE_RECOMMENDATIONS,
            "free_l1_l2_repair_routes": FREE_REPAIR_ROUTE_RECOMMENDATIONS,
            "paid_l1_l2_full_coverage": PAID_DATASET_RECOMMENDATIONS,
        },
    }


def preflight_report(cache_dir: str | Path | None = None) -> dict[str, Any]:
    root = resolve_cache_dir(cache_dir)
    root_exists = root.exists()
    parent = root if root_exists else root.parent
    try:
        usage = shutil.disk_usage(parent)
        disk = {
            "path": str(parent),
            "free_gb": round(usage.free / (1024**3), 2),
            "total_gb": round(usage.total / (1024**3), 2),
            "enough_for_20gb_dataset": usage.free >= 30 * (1024**3),
        }
    except Exception as exc:
        disk = {"path": str(parent), "error": str(exc), "enough_for_20gb_dataset": False}
    kaggle_path = shutil.which("kaggle")
    if not kaggle_path:
        local_kaggle = Path(sys.executable).with_name("kaggle.exe")
        if local_kaggle.exists():
            kaggle_path = str(local_kaggle)
    return {
        "generated_at": utc_now(),
        "cache_dir": str(root),
        "kaggle_cli": {
            "available": bool(kaggle_path),
            "path": kaggle_path,
        },
        "kaggle_auth_status": kaggle_credential_status(),
        "polygon_status": polygon_credential_status(),
        "eodhd_status": eodhd_credential_status(),
        "free_repair_routes": free_repair_route_status(),
        "duckdb": _optional_import_status("duckdb"),
        "pyarrow": _optional_import_status("pyarrow"),
        "disk": disk,
        "recommended_search_terms": KAGGLE_SEARCH_TERMS,
        "recommended_datasets": KAGGLE_DATASET_RECOMMENDATIONS,
        "recommended_paid_l1_l2_sources": PAID_DATASET_RECOMMENDATIONS,
    }


def _optional_import_status(module_name: str) -> dict[str, Any]:
    try:
        module = __import__(module_name)
    except Exception as exc:
        return {"available": False, "error": str(exc)}
    version = getattr(module, "__version__", None)
    return {"available": True, "version": str(version) if version else None}


@dataclass(frozen=True)
class MatrixMembershipEvent:
    effective_date: str
    symbol: str
    raw_symbol: str
    membership_status: str
    source: str
    source_revision_id: str | None = None
    company_name: str | None = None

    def as_membership_row(self) -> dict[str, Any]:
        metadata: dict[str, Any] = {}
        if self.source_revision_id:
            metadata["source_revision_id"] = self.source_revision_id
        if self.company_name:
            metadata["company_name"] = self.company_name
        return {
            "effective_date": self.effective_date,
            "symbol": self.symbol,
            "raw_symbol": self.raw_symbol,
            "membership_status": self.membership_status,
            "source": self.source,
            "metadata": metadata,
        }


def normalize_symbol(value: Any) -> str:
    return str(value or "").strip().upper().replace(".", "-")


def _first_present(row: Mapping[str, Any], candidates: Sequence[str]) -> str:
    lower_index = {str(key).strip().lower(): key for key in row}
    for candidate in candidates:
        key = lower_index.get(candidate.lower())
        if key is not None and str(row.get(key) or "").strip():
            return str(row.get(key) or "").strip()
    return ""


def _split_matrix_tickers(value: str) -> list[str]:
    normalized = value.replace(";", ",").replace("|", ",")
    return [item.strip() for item in normalized.split(",") if item.strip()]


def parse_sp500_matrix_csv(
    path: str | Path,
    *,
    source: str = "github_sp500_historical_components",
    source_revision_id: str | None = None,
) -> list[MatrixMembershipEvent]:
    events: list[MatrixMembershipEvent] = []
    with Path(path).open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            event_date = _first_present(row, ["effective_date", "date", "Date", "from", "start_date"])
            snapshot_tickers = _first_present(row, ["tickers", "members", "constituents", "symbols"])
            if event_date and snapshot_tickers:
                seen_symbols: set[str] = set()
                for ticker in _split_matrix_tickers(snapshot_tickers):
                    symbol = normalize_symbol(ticker)
                    if not symbol or symbol in seen_symbols:
                        continue
                    seen_symbols.add(symbol)
                    events.append(
                        MatrixMembershipEvent(
                            effective_date=event_date[:10],
                            symbol=symbol,
                            raw_symbol=ticker,
                            membership_status="MEMBER",
                            source=source,
                            source_revision_id=source_revision_id,
                        )
                    )
                continue
            raw_symbol = _first_present(row, ["symbol", "ticker", "Ticker", "added_ticker", "security"])
            removed_symbol = _first_present(row, ["removed_ticker", "removed", "ticker_removed"])
            added_symbol = _first_present(row, ["added_ticker", "added", "ticker_added"])
            company_name = _first_present(row, ["company_name", "security_name", "name", "company"])
            if added_symbol:
                raw_symbol = added_symbol
            elif removed_symbol:
                raw_symbol = removed_symbol
            status = _first_present(row, ["membership_status", "status", "action"])
            normalized_status = status.upper() if status else ("REMOVED" if removed_symbol and not added_symbol else "ACTIVE")
            if normalized_status in {"ADDED", "ADD", "IN"}:
                normalized_status = "ACTIVE"
            if normalized_status in {"REMOVE", "DELETED", "DELETE", "OUT"}:
                normalized_status = "REMOVED"
            if not event_date or not raw_symbol:
                continue
            symbol = normalize_symbol(raw_symbol)
            if not symbol:
                continue
            events.append(
                MatrixMembershipEvent(
                    effective_date=event_date[:10],
                    symbol=symbol,
                    raw_symbol=raw_symbol,
                    membership_status=normalized_status,
                    source=source,
                    source_revision_id=source_revision_id,
                    company_name=company_name or None,
                )
            )
    events.sort(key=lambda item: (item.effective_date, item.symbol, item.membership_status))
    return events


def matrix_manifest_from_events(
    events: Sequence[MatrixMembershipEvent],
    *,
    source_url: str,
    source_revision_id: str | None = None,
) -> dict[str, Any]:
    effective_dates = [event.effective_date for event in events if event.effective_date]
    return {
        "source_kind": "sp500_historical_components",
        "provider_id": "github_sp500_historical_components",
        "source_url": source_url,
        "source_revision_id": source_revision_id,
        "member_event_count": len(events),
        "effective_start": min(effective_dates) if effective_dates else None,
        "effective_end": max(effective_dates) if effective_dates else None,
        "row_count": len(events),
        "pit_mode": "membership_matrix",
    }

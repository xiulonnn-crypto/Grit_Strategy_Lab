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
    "tiingo": {
        "source_url": "https://www.tiingo.com/documentation/end-of-day",
        "license": "account_terms",
        "source_manifest_required": False,
    },
    "tiingo_symbology": {
        "source_url": "https://www.tiingo.com/documentation/general/overview",
        "license": "account_terms",
        "source_manifest_required": False,
    },
    "fmp": {
        "source_url": "https://site.financialmodelingprep.com/developer/docs/stable",
        "license": "account_terms",
        "source_manifest_required": False,
    },
    "fmp_historical_constituent": {
        "source_url": "https://site.financialmodelingprep.com/developer/docs/stable/historical-sp-500",
        "license": "account_terms",
        "source_manifest_required": False,
    },
    "stooq": {
        "source_url": "https://stooq.com/q/d/l/",
        "license": "public_download_terms",
        "source_manifest_required": True,
    },
    "nasdaq_wiki": {
        "source_url": "https://data.nasdaq.com/api/v3/datasets/WIKI/{symbol}.json",
        "license": "account_terms_legacy_database",
        "source_manifest_required": False,
    },
    "finnhub": {
        "source_url": "https://finnhub.io/docs/api",
        "license": "account_terms",
        "source_manifest_required": False,
    },
    "sec_edgar": {
        "source_url": "https://www.sec.gov/edgar/sec-api-documentation",
        "license": "public_sec_data",
        "source_manifest_required": False,
    },
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
            "nasdaq_wiki",
            "Nasdaq Data Link WIKI",
            "free_account",
            ("price_history", "long_history_price_patch", "delisted_price_history"),
            fallback_order={"price_history": 7, "long_history_price_patch": 1, "delisted_price_history": 1},
            required_env_vars=("NASDAQ_DATA_LINK_API_KEY",),
            pit_mode="price_only",
            can_upgrade_pit_readiness=True,
            pit_notes=("WIKI rows are legacy price evidence through 2018 and do not certify corporate actions.",),
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
            "free_account",
            ("price_history", "identity"),
            fallback_order={"price_history": 7, "identity": 3},
            required_env_vars=("FMP_API_KEY",),
        ),
        _definition(
            "fmp_historical_constituent",
            "FMP Historical Constituents",
            "free_account",
            ("universe_history",),
            fallback_order={"universe_history": 1},
            required_env_vars=("FMP_API_KEY",),
        ),
        _definition(
            "finnhub",
            "Finnhub",
            "free_account",
            ("identity", "targeted_price_repair"),
            fallback_order={"identity": 4, "targeted_price_repair": 2},
            required_env_vars=("FINNHUB_API_KEY",),
            pit_mode="identity_only",
            can_upgrade_pit_readiness=True,
            pit_notes=("Finnhub profile and listing status are identity evidence; candle rows are targeted fallback only.",),
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
            ("identity", "lifecycle_filings", "corporate_actions"),
            fallback_order={"identity": 5, "corporate_actions": 5},
            required_env_vars=("SEC_USER_AGENT",),
            pit_mode="identity_only",
            can_upgrade_pit_readiness=True,
            pit_notes=("CIK and filing history provide identity/lifecycle evidence; SEC EDGAR does not provide OHLCV price bars.",),
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


DEFAULT_TRUST_PROFILE = {
    "trust_tier": "supporting",
    "evidence_scope": ["provider availability"],
    "can_upgrade_full_ready": True,
    "pit_role": "辅助数据源",
    "limitations": ["需要结合价格、成员历史、公司行动和身份映射四类证据判断 Full Ready。"],
    "operator_action": "查看最近尝试和缺失凭据后再决定是否纳入修复队列。",
}

TRUST_PROFILE_OVERRIDES: dict[str, dict[str, Any]] = {
    "yahoo": {
        "trust_tier": "baseline_public",
        "evidence_scope": ["EOD OHLCV", "standard corporate actions"],
        "can_upgrade_full_ready": True,
        "pit_role": "公开价格与公司行动基线",
        "limitations": ["公开源适合日常刷新，但旧退市 ticker 和历史成员变更仍需交叉确权。"],
        "operator_action": "保留为默认公开基线；关键历史缺口继续进入 Tiingo/FMP/SEC 修复链。",
    },
    "yfinance": {
        "trust_tier": "baseline_public",
        "evidence_scope": ["EOD OHLCV", "standard corporate actions"],
        "can_upgrade_full_ready": True,
        "pit_role": "Yahoo 适配层",
        "limitations": ["不能单独证明历史指数成员 in/out 日期或 CIK 生命周期。"],
        "operator_action": "用于公开行情基线；缺口进入正式修复队列。",
    },
    "tiingo": {
        "trust_tier": "primary_eod_action",
        "evidence_scope": ["EOD OHLCV", "dividend/split actions", "delisted-aware daily data"],
        "can_upgrade_full_ready": True,
        "pit_role": "PIT 修复队列第一主力",
        "limitations": ["需要 TIINGO_API_TOKEN；不能单独证明指数成员 in/out 日期。"],
        "operator_action": "配置 TIINGO_API_TOKEN 后优先重跑 repair 队列。",
    },
    "tiingo_symbology": {
        "trust_tier": "identity_mapping",
        "evidence_scope": ["ticker identity", "canonical symbol", "CIK hint", "delisting metadata"],
        "can_upgrade_full_ready": False,
        "pit_role": "身份映射辅助",
        "limitations": ["只提供身份线索，不能补 OHLCV 或公司行动事件。"],
        "operator_action": "配置 TIINGO_API_TOKEN 后用于 identity scraper 和 alias 候选。",
    },
    "fmp": {
        "trust_tier": "free_account_identity_price_patch",
        "evidence_scope": ["delisted identity", "price patch", "company metadata"],
        "can_upgrade_full_ready": True,
        "pit_role": "退市身份与可用价格补丁",
        "limitations": ["免费层有日请求额度；价格补丁仍需公司行动或 zero-event 证据配合。"],
        "operator_action": "配置 FMP_API_KEY 后用于退市身份和价格缺口补丁。",
    },
    "fmp_historical_constituent": {
        "trust_tier": "membership_history",
        "evidence_scope": ["S&P 500 historical constituents", "in/out dates"],
        "can_upgrade_full_ready": False,
        "pit_role": "成分股历史专家",
        "limitations": ["只证明成员历史，不能补价格或公司行动。"],
        "operator_action": "配置 FMP_API_KEY 后用于 historical universe lane 和 zero-event 上下文。",
    },
    "github_sp500_historical_components": {
        "trust_tier": "membership_matrix",
        "evidence_scope": ["S&P 500 historical membership matrix"],
        "can_upgrade_full_ready": False,
        "pit_role": "历史成员骨架",
        "limitations": ["membership-only；不能补价格、公司行动或身份。"],
        "operator_action": "保留 manifest 与来源版本，用于 PIT 成员历史证据。",
    },
    "stooq": {
        "trust_tier": "long_history_price_patch",
        "evidence_scope": ["long-horizon EOD OHLCV", "single-symbol online CSV when enabled"],
        "can_upgrade_full_ready": False,
        "pit_role": "长周期价格补丁",
        "limitations": ["price-only；不能证明分红/拆股事件、成员历史或 CIK 身份。"],
        "operator_action": "优先使用 offline ZIP；需要在线补丁时显式设置 GRIT_ENABLE_STOOQ_ONLINE=1。",
    },
    "nasdaq_wiki": {
        "trust_tier": "long_history_price_patch",
        "evidence_scope": ["WIKI adjusted OHLCV through 2018", "legacy delisted price candidates"],
        "can_upgrade_full_ready": False,
        "pit_role": "Legacy price-only patch for pre-2018 US equities.",
        "limitations": ["Price-only; does not certify dividends, splits, identity, or current prices."],
        "operator_action": "Configure NASDAQ_DATA_LINK_API_KEY or load a local WIKI cache before long-history repair.",
    },
    "kaggle_huge_stock_market_dataset": {
        "trust_tier": "bulk_price_cache",
        "evidence_scope": ["bulk adjusted OHLCV", "delisted price candidates"],
        "can_upgrade_full_ready": False,
        "pit_role": "批量价格缓存",
        "limitations": ["price-only；必须保留 dataset manifest，不能单独升级公司行动或身份门禁。"],
        "operator_action": "下载前记录 license、manifest 和覆盖区间，只导入本地缓存。",
    },
    "kaggle_delisted_bulk_archive": {
        "trust_tier": "bulk_price_cache",
        "evidence_scope": ["delisted adjusted OHLCV candidates"],
        "can_upgrade_full_ready": False,
        "pit_role": "退市价格缓存候选",
        "limitations": ["price-only；dataset license 和字段覆盖必须人工确认。"],
        "operator_action": "作为 Stooq/Tiingo/FMP 之后的批量价格补丁候选。",
    },
    "sec_edgar": {
        "trust_tier": "identity_lifecycle_authority",
        "evidence_scope": ["CIK", "SEC submissions", "last filing evidence"],
        "can_upgrade_full_ready": False,
        "pit_role": "身份与生命周期确权",
        "limitations": ["identity-only；SEC EDGAR 不提供价格，也不能把停止申报直接写成破产结论。"],
        "operator_action": "配置含联系邮箱的 SEC_USER_AGENT，用 CIK 证明身份和生命周期上下文。",
    },
    "finnhub": {
        "trust_tier": "identity_listing_crosscheck",
        "evidence_scope": ["company profile", "listing status", "targeted candle fallback"],
        "can_upgrade_full_ready": False,
        "pit_role": "Identity and listing-status cross-check with limited targeted price fallback.",
        "limitations": ["Industry fields are supporting metadata only and are not authoritative PIT GICS evidence."],
        "operator_action": "Configure FINNHUB_API_KEY for profile/listing validation after SEC/FMP/Tiingo identity checks.",
    },
    "alpha_vantage": {
        "trust_tier": "targeted_action_identity",
        "evidence_scope": ["corporate actions", "listing status", "targeted repair"],
        "can_upgrade_full_ready": True,
        "pit_role": "公司行动与 targeted repair 辅助",
        "limitations": ["免费层频率低，容易进入 cooldown。"],
        "operator_action": "只在 targeted repair 或公司行动补证时使用，注意免费层冷却窗口。",
    },
    "polygon": {
        "trust_tier": "paid_precision_lane",
        "evidence_scope": ["precision OHLCV", "corporate actions", "identity"],
        "can_upgrade_full_ready": True,
        "pit_role": "付费精修来源",
        "limitations": ["需要 POLYGON_API_KEY；仅用于关键缺口，不作为默认免费链。"],
        "operator_action": "有 key 时用于关键 delisted、生命周期或公司行动精修候选。",
    },
}

DATA_TRUST_LAYER_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "id": "price_primary_chain",
        "label": "价格主链",
        "role": "可审计 EOD OHLCV",
        "provider_ids": ("tiingo", "yahoo", "yfinance", "fmp", "openbb_tiingo", "openbb_yfinance", "openbb_fmp"),
        "preferred_provider": "tiingo",
        "evidence_scope": ["EOD OHLCV", "adjusted close", "repair queue price evidence"],
        "full_ready_gate": "价格缺口必须由可审计 provider 入库，price-only 源不能替代公司行动或身份门禁。",
    },
    {
        "id": "membership_history",
        "label": "成分股历史",
        "role": "PIT 成员 in/out 日期",
        "provider_ids": ("fmp_historical_constituent", "github_sp500_historical_components", "wikipedia_revision_history", "official_announcement"),
        "preferred_provider": "fmp_historical_constituent",
        "evidence_scope": ["historical constituents", "membership in/out dates", "point-in-time universe anchors"],
        "full_ready_gate": "membership-only 源只能通过样本池历史门禁，不能单独升级 Full Ready。",
    },
    {
        "id": "delisted_identity",
        "label": "退市 / 身份",
        "role": "ticker 生命周期和 CIK",
        "provider_ids": ("sec_edgar", "tiingo_symbology", "fmp", "finnhub", "alpha_vantage"),
        "preferred_provider": "sec_edgar",
        "evidence_scope": ["CIK", "delisting metadata", "canonical symbol", "filing lifecycle"],
        "full_ready_gate": "identity-only 源不能补 OHLCV；用于证明标的身份和不可恢复缺口上下文。",
    },
    {
        "id": "corporate_actions_zero_event",
        "label": "公司行动 / 零事件",
        "role": "dividend/split 或 zero-event certificate",
        "provider_ids": ("tiingo", "yahoo", "alpha_vantage", "fmp", "sec_edgar", "polygon"),
        "preferred_provider": "tiingo",
        "evidence_scope": ["dividend events", "split events", "zero-event certificate context"],
        "full_ready_gate": "公司行动缺口必须由事件 provider 或 zero-event certificate 关闭。",
    },
    {
        "id": "long_history_patch",
        "label": "长周期补丁",
        "role": "70/80/90 年代价格补丁",
        "provider_ids": ("nasdaq_wiki", "stooq", "kaggle_huge_stock_market_dataset", "kaggle_delisted_bulk_archive"),
        "preferred_provider": "nasdaq_wiki",
        "evidence_scope": ["long-horizon OHLCV", "delisted price rows"],
        "full_ready_gate": "price-only，只能修复价格缺口，不能单独通过公司行动或身份门禁。",
    },
    {
        "id": "precision_repair",
        "label": "精修来源",
        "role": "关键缺口付费精修",
        "provider_ids": ("polygon",),
        "preferred_provider": "polygon",
        "evidence_scope": ["precision price repair", "corporate actions", "identity"],
        "full_ready_gate": "用于免费链无法闭合的关键缺口，仍不暴露密钥值。",
    },
)


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
    if callable(getattr(provider, "fetch_history", None)) and provider_id not in {
        "alpha_vantage",
        "openbb_alpha_vantage",
        "finnhub",
    }:
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


def _trust_profile(
    *,
    provider_id: str,
    definition: ProviderDefinition | None,
    credential_requirements: Mapping[str, Any],
    pit_permission: Mapping[str, Any],
    readiness_status: str,
) -> dict[str, Any]:
    override = TRUST_PROFILE_OVERRIDES.get(provider_id, {})
    profile = {**DEFAULT_TRUST_PROFILE, **override}
    if not override and definition:
        profile["pit_role"] = definition.source_name
        profile["evidence_scope"] = list(definition.target_types)
        profile["can_upgrade_full_ready"] = bool(definition.can_upgrade_pit_readiness)
    profile["evidence_scope"] = [
        str(item)
        for item in (profile.get("evidence_scope") or [])
        if str(item).strip()
    ]
    profile["limitations"] = [
        str(item)
        for item in (profile.get("limitations") or [])
        if str(item).strip()
    ]
    missing_env_vars = [
        str(item)
        for item in (credential_requirements.get("missing_env_vars") or [])
        if str(item).strip()
    ]
    configured_env_vars = [
        str(item)
        for item in (credential_requirements.get("configured_env_vars") or [])
        if str(item).strip()
    ]
    profile["can_upgrade_pit_readiness"] = bool(pit_permission.get("can_upgrade_pit_readiness", True))
    profile["credential_status"] = "missing" if missing_env_vars else ("configured" if configured_env_vars else "not_required")
    profile["missing_env_vars"] = missing_env_vars
    profile["readiness_status"] = readiness_status
    profile["secret_persistence"] = "disabled"
    profile.setdefault("operator_action", DEFAULT_TRUST_PROFILE["operator_action"])
    return profile


def _trust_layer_status(provider_rows: Sequence[Mapping[str, Any]]) -> str:
    if not provider_rows:
        return "missing"
    if any(item.get("usable") for item in provider_rows):
        return "usable"
    if any(item.get("enabled") and item.get("credential_ready") for item in provider_rows):
        return "enabled"
    if any((item.get("credential_requirements") or {}).get("missing_env_vars") for item in provider_rows):
        return "missing_credentials"
    if any(item.get("enabled") for item in provider_rows):
        return "blocked"
    return "registered"


def _trust_layer_operator_action(layer: Mapping[str, Any], provider_rows: Sequence[Mapping[str, Any]]) -> str:
    preferred_provider = str(layer.get("preferred_provider") or "")
    preferred = next((item for item in provider_rows if str(item.get("provider_id") or "") == preferred_provider), None)
    if preferred:
        profile = preferred.get("trust_profile") if isinstance(preferred.get("trust_profile"), Mapping) else {}
        action = str((profile or {}).get("operator_action") or "").strip()
        if action:
            return action
    missing_env = [
        str(env)
        for item in provider_rows
        for env in ((item.get("credential_requirements") or {}).get("missing_env_vars") or [])
        if str(env).strip()
    ]
    if missing_env:
        return f"补齐 {', '.join(dict.fromkeys(missing_env))} 后重新检查。"
    return "查看 registry 最近尝试与限制说明，再决定是否进入修复队列。"


def _latest_job_id_for_attempts(attempt_items: Sequence[Mapping[str, Any]]) -> str | None:
    latest_job_id = ""
    latest_attempted_at = ""
    for item in attempt_items:
        job_id = str(item.get("job_id") or "").strip()
        if not job_id:
            continue
        attempted_at = str(item.get("attempted_at") or "")
        if (attempted_at, job_id) >= (latest_attempted_at, latest_job_id):
            latest_attempted_at = attempted_at
            latest_job_id = job_id
    return latest_job_id or None


def _join_readable_names(items: Sequence[str]) -> str:
    ordered: list[str] = []
    for item in items:
        text = str(item or "").strip()
        if text and text not in ordered:
            ordered.append(text)
    return "、".join(ordered)


def _provider_label(provider_row: Mapping[str, Any]) -> str:
    return str(provider_row.get("source_name") or provider_row.get("provider_id") or "").strip()


def _provider_required_envs(provider_row: Mapping[str, Any]) -> list[str]:
    credential_requirements = (
        provider_row.get("credential_requirements")
        if isinstance(provider_row.get("credential_requirements"), Mapping)
        else {}
    )
    required_envs = [
        str(env)
        for env in (credential_requirements.get("required_env_vars") or [])
        if str(env).strip()
    ]
    if required_envs:
        return list(dict.fromkeys(required_envs))
    configured_envs = [
        str(env)
        for env in (credential_requirements.get("configured_env_vars") or [])
        if str(env).strip()
    ]
    return list(dict.fromkeys(configured_envs))


def _provider_has_current_credential_rejection(
    provider_row: Mapping[str, Any],
    rollup_row: Mapping[str, Any],
) -> bool:
    if int(rollup_row.get("latest_job_event_count") or 0) <= 0:
        return False
    error_summary = provider_row.get("error_summary") if isinstance(provider_row.get("error_summary"), Mapping) else {}
    reason_blob = " ".join(
        str(error_summary.get(key) or "")
        for key in ("reason", "error")
    ).lower()
    return any(
        token in reason_blob
        for token in (
            "credential_rejected",
            "invalid_credentials",
            "invalid_api_key",
            "invalid api key",
            "unauthorized",
            "forbidden",
        )
    )


def _provider_is_currently_cooling_down(
    provider_row: Mapping[str, Any],
    rollup_row: Mapping[str, Any],
) -> bool:
    quota_cooldown = provider_row.get("quota_cooldown") if isinstance(provider_row.get("quota_cooldown"), Mapping) else {}
    return bool(
        provider_row.get("readiness_status") == "cooldown"
        or rollup_row.get("cooldown_active")
        or rollup_row.get("quota_limited")
        or quota_cooldown.get("cooldown_active")
        or quota_cooldown.get("quota_limited")
    )


def _provider_current_issue_message(
    provider_row: Mapping[str, Any],
    rollup_row: Mapping[str, Any],
) -> str | None:
    label = _provider_label(provider_row)
    env_text = _join_readable_names(_provider_required_envs(provider_row))
    if _provider_has_current_credential_rejection(provider_row, rollup_row):
        key_label = env_text or "当前凭据"
        return f"{label} 当前返回凭据被拒，请核对或更换 {key_label}。"
    if _provider_is_currently_cooling_down(provider_row, rollup_row):
        quota_cooldown = (
            provider_row.get("quota_cooldown")
            if isinstance(provider_row.get("quota_cooldown"), Mapping)
            else {}
        )
        next_retry_at = str(quota_cooldown.get("next_retry_at") or "").strip()
        if next_retry_at:
            return f"{label} 当前处于冷却窗口，{next_retry_at} 后可重跑。"
        return f"{label} 当前处于冷却窗口，待窗口结束后重跑。"
    if int(rollup_row.get("latest_job_event_count") or 0) <= 0:
        return None
    status = str(rollup_row.get("status") or "").strip().lower()
    if status not in {"failed", "unavailable"}:
        return None
    error_summary = provider_row.get("error_summary") if isinstance(provider_row.get("error_summary"), Mapping) else {}
    reason_blob = " ".join(
        str(error_summary.get(key) or "")
        for key in ("reason", "error")
    ).lower()
    if "entitlement_required" in reason_blob:
        return f"{label} 当前账号权限不足，需要提升套餐或改走其他证据源。"
    return f"{label} 最近一次刷新未通过，请复查后重跑。"


def _provider_is_available_in_latest_job(
    provider_row: Mapping[str, Any],
    rollup_row: Mapping[str, Any],
) -> bool:
    if not bool(provider_row.get("enabled")) or not bool(provider_row.get("credential_ready")):
        return False
    if _provider_has_current_credential_rejection(provider_row, rollup_row):
        return False
    if _provider_is_currently_cooling_down(provider_row, rollup_row):
        return False
    if int(rollup_row.get("latest_job_event_count") or 0) <= 0:
        return False
    status = str(rollup_row.get("status") or "").strip().lower()
    return status in {"succeeded", "skipped"}


def _provider_is_configured_but_not_exercised(
    provider_row: Mapping[str, Any],
    rollup_row: Mapping[str, Any],
) -> bool:
    if not bool(provider_row.get("enabled")) or not bool(provider_row.get("credential_ready")):
        return False
    if _provider_has_current_credential_rejection(provider_row, rollup_row):
        return False
    if _provider_is_currently_cooling_down(provider_row, rollup_row):
        return False
    return int(rollup_row.get("latest_job_event_count") or 0) <= 0


def _trust_layer_operator_action_live(
    layer: Mapping[str, Any],
    provider_rows: Sequence[Mapping[str, Any]],
    attempt_rollup_by_provider: Mapping[str, Mapping[str, Any]],
) -> str:
    preferred_provider = str(layer.get("preferred_provider") or "")
    preferred = next((item for item in provider_rows if str(item.get("provider_id") or "") == preferred_provider), None)
    preferred_profile = preferred.get("trust_profile") if isinstance((preferred or {}).get("trust_profile"), Mapping) else {}
    preferred_action = str((preferred_profile or {}).get("operator_action") or "").strip()

    missing_env = [
        str(env)
        for item in provider_rows
        for env in ((item.get("credential_requirements") or {}).get("missing_env_vars") or [])
        if str(env).strip()
    ]
    if missing_env:
        return f"补齐 {_join_readable_names(missing_env)} 后重跑该层证据。"

    available_labels: list[str] = []
    standby_labels: list[str] = []
    issue_messages: list[str] = []
    for item in provider_rows:
        provider_id = str(item.get("provider_id") or "").strip()
        rollup_row = (
            attempt_rollup_by_provider.get(provider_id)
            if isinstance(attempt_rollup_by_provider.get(provider_id), Mapping)
            else {}
        )
        issue_message = _provider_current_issue_message(item, rollup_row)
        if issue_message:
            issue_messages.append(issue_message)
            continue
        if _provider_is_available_in_latest_job(item, rollup_row):
            available_labels.append(_provider_label(item))
            continue
        if _provider_is_configured_but_not_exercised(item, rollup_row):
            standby_labels.append(_provider_label(item))

    parts: list[str] = []
    if available_labels:
        parts.append(f"当前可用：{_join_readable_names(available_labels)}。")
    parts.extend(issue_messages)
    if standby_labels:
        parts.append(f"已配置但本轮未命中：{_join_readable_names(standby_labels)}。需要该层补证时可单独重跑。")
    if parts:
        return " ".join(parts)
    if preferred_action:
        return preferred_action
    return "查看最近尝试与凭据状态后，再决定下一步修复动作。"


def build_data_trust_summary(
    *,
    registry_items: Sequence[Mapping[str, Any]],
    attempt_items: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    latest_job_id = _latest_job_id_for_attempts(attempt_items)
    attempt_rollup = build_provider_attempt_rollup(attempt_items, latest_job_id=latest_job_id)
    attempt_rollup_by_provider = {
        str(item.get("provider_id") or "").strip(): dict(item)
        for item in (attempt_rollup.get("providers") or [])
        if str(item.get("provider_id") or "").strip()
    }
    by_provider = {
        str(item.get("provider_id") or "").strip(): dict(item)
        for item in registry_items
        if str(item.get("provider_id") or "").strip()
    }
    layers: list[dict[str, Any]] = []
    for layer in DATA_TRUST_LAYER_DEFINITIONS:
        provider_ids = [str(item) for item in layer.get("provider_ids") or [] if str(item).strip()]
        provider_rows = [by_provider[provider_id] for provider_id in provider_ids if provider_id in by_provider]
        missing_env = [
            str(env)
            for item in provider_rows
            for env in ((item.get("credential_requirements") or {}).get("missing_env_vars") or [])
            if str(env).strip()
        ]
        usable_provider_ids = [
            str(item.get("provider_id"))
            for item in provider_rows
            if item.get("usable")
        ]
        enabled_provider_ids = [
            str(item.get("provider_id"))
            for item in provider_rows
            if item.get("enabled")
        ]
        layers.append(
            {
                "id": layer["id"],
                "label": layer["label"],
                "role": layer["role"],
                "status": _trust_layer_status(provider_rows),
                "provider_ids": provider_ids,
                "registered_provider_ids": [str(item.get("provider_id")) for item in provider_rows],
                "enabled_provider_ids": enabled_provider_ids,
                "usable_provider_ids": usable_provider_ids,
                "missing_env_vars": list(dict.fromkeys(missing_env)),
                "preferred_provider": layer.get("preferred_provider"),
                "evidence_scope": list(layer.get("evidence_scope") or []),
                "full_ready_gate": layer.get("full_ready_gate"),
                "operator_action": _trust_layer_operator_action_live(layer, provider_rows, attempt_rollup_by_provider),
                "provider_count": len(provider_rows),
                "usable_provider_count": len(usable_provider_ids),
            }
        )
    attempt_status_counts: dict[str, int] = {}
    for attempt in attempt_items:
        status = str(attempt.get("status") or "").strip().lower()
        if status:
            attempt_status_counts[status] = attempt_status_counts.get(status, 0) + 1
    return {
        "generated_at": _utc_now(),
        "status": "usable" if any(layer.get("status") == "usable" for layer in layers) else "needs_configuration",
        "summary_label": "数据可信层",
        "layers": layers,
        "layer_count": len(layers),
        "usable_layer_count": sum(1 for layer in layers if layer.get("status") == "usable"),
        "missing_credential_layer_count": sum(1 for layer in layers if layer.get("status") == "missing_credentials"),
        "attempt_status_counts": dict(sorted(attempt_status_counts.items())),
        "full_ready_rules": [
            "FULL_READY 必须同时具备可审计价格、PIT 成员历史、公司行动或 zero-event certificate、稳定身份映射。",
            "PRICE_ONLY 来源只能修复价格缺口，不能单独升级公司行动或身份门禁。",
            "IDENTITY_ONLY 来源只能证明身份和生命周期，不能补 OHLCV。",
        ],
    }


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
        pit_permission = _pit_effect(provider_id, bool((latest_attempt or {}).get("auxiliary_only")))
        readiness_status = _provider_readiness_status(
            enabled=enabled,
            credential_ready=credential_ready,
            quota_limited=bool(quota_cooldown.get("quota_limited")),
            cooldown_active=bool(quota_cooldown.get("cooldown_active")),
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
                "pit_permission": pit_permission,
                "source_governance": _source_governance(provider_id),
                "trust_profile": _trust_profile(
                    provider_id=provider_id,
                    definition=definition,
                    credential_requirements=credential_requirements,
                    pit_permission=pit_permission,
                    readiness_status=readiness_status,
                ),
                "enabled": enabled,
                "credential_ready": credential_ready,
                "usable": usable,
                "readiness_status": readiness_status,
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

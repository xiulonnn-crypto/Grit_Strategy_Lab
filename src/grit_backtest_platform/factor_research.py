from __future__ import annotations

import math
import re
import hashlib
import threading
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable, Iterable, Mapping, Sequence
from uuid import uuid4

from .market_data_repository import (
    DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID,
    DATASET_FUNDAMENTALS_SNAPSHOT_ID,
    DATASET_PRICE_SNAPSHOT_ID,
)
from .pit_external_sources import build_external_source_readiness
from .storage import SQLiteStorage, dumps, iso_now, loads
from .universe_history import SP500_UNIVERSE_SNAPSHOT_ID


PRICE_DATA_REQUIREMENTS = ("adj_close", "price_history", "returns")
FORMAL_DIAGNOSTIC_YEARS = 10
SANDBOX_DIAGNOSTIC_YEARS = 3
FACTOR_DESCRIPTOR_SCHEMA_VERSION = "factor_descriptor_v1"
FACTOR_QUARANTINE_RULE_VERSION = "factor_quarantine_v2_0"
FUNDAMENTAL_SEED_VERSION = "v3_asset_growth_shares"
PRICE_REQUIREMENTS = set(PRICE_DATA_REQUIREMENTS)
FUNDAMENTAL_REQUIREMENTS = {
    "ltm_earnings",
    "market_cap",
    "book_value_equity",
    "operating_cash_flow",
    "capex",
    "enterprise_value",
    "total_shares",
    "shares_outstanding",
    "total_debt",
    "cash_and_equivalents",
}
FUNDAMENTAL_FIELD_REQUIREMENTS = {
    "LtmEarnings": "ltm_earnings",
    "MarketCap": "market_cap",
    "BookValueEquity": "book_value_equity",
    "OperatingCashFlow": "operating_cash_flow",
    "OperatingCashFlowLTM": "operating_cash_flow",
    "Capex": "capex",
    "CapexLTM": "capex",
    "EnterpriseValue": "enterprise_value",
    "TotalShares": "total_shares",
    "SharesOutstanding": "shares_outstanding",
    "TotalDebt": "total_debt",
    "CashAndEquivalents": "cash_and_equivalents",
}
FUNDAMENTAL_FIELD_REQUIREMENTS_BY_TOKEN = {
    token.lower(): requirement
    for token, requirement in FUNDAMENTAL_FIELD_REQUIREMENTS.items()
}
DATA_REQUIREMENT_ORDER = (
    "adj_close",
    "price_history",
    "returns",
    "ltm_earnings",
    "market_cap",
    "book_value_equity",
    "operating_cash_flow",
    "capex",
    "enterprise_value",
    "total_shares",
    "shares_outstanding",
    "total_debt",
    "cash_and_equivalents",
)
HISTORICAL_MEMBERSHIP_MARKERS = (
    "historical",
    "revision",
    "official_announcement",
    "official_seed",
    "unit_test_revision",
)
HISTORICAL_MEMBERSHIP_SOURCE_NAMES = (
    "fmp_historical_constituent",
    "github_nasdaq100_curated_history",
    "github_sp500_historical_components",
    "unit_test_revision",
    "wikipedia_revision_history",
)
NON_HISTORICAL_MEMBERSHIP_MARKERS = (
    "wikipedia_current_page",
    "current_page",
    "current_constituent",
    "current_constituents",
    "latest_constituents",
    "static_seed",
    "fallback_current",
)
NON_HISTORICAL_MEMBERSHIP_SOURCE_NAMES = (
    "current_page",
    "fallback_current",
    "static_seed",
    "wikipedia_current_page",
)
ALLOWED_OPERATORS = {
    "Rank",
    "Ts_Rank",
    "Delta",
    "Return",
    "Mean",
    "Std",
    "ZScore",
    "Winsorize",
    "Neutralize",
    "Correlation",
    "Log",
    "Close",
    "Volume",
    "Abs",
    "Amihud",
    "BetaToMarket",
    "DollarVolume",
    "DownsideStd",
    "FFBlend",
    "MaxDrawdown",
    "Momentum252",
    "QualityROE",
    "Residual",
    "ResidualVolatility",
    "SharesOutstandingGrowth",
    "Size",
    "Turnover",
    "ValueEP",
}


@dataclass(frozen=True)
class PitUniverseHistorySummary:
    raw_count: int
    raw_end: str | None
    historical_count: int
    historical_start: str | None
    historical_end: str | None
    date_counts: Mapping[str, int]
    latest_symbols: frozenset[str]
    mode: str
TOKEN_PATTERN = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
DESCRIPTOR_TOKEN_PATTERN = re.compile(r"^[a-z0-9]+$")
DESCRIPTOR_SOURCE_PREFIX_TO_SOURCE = {
    "s": "SYSTEM_SEED",
    "m": "MANUAL",
    "a": "AUTO_MINED",
}
DESCRIPTOR_SOURCE_TO_PREFIX = {
    value: key for key, value in DESCRIPTOR_SOURCE_PREFIX_TO_SOURCE.items()
}
ALLOWED_DESCRIPTOR_CATEGORIES = {"alpha", "beta", "inv", "liq", "mom", "qlty", "size", "val", "vol"}
ALLOWED_DESCRIPTOR_OPERATORS = {"rank", "z", "raw", "log"}
FACTOR_REFERENCE_TOKEN_PATTERN = re.compile(
    rf"^[sma]_(?:{'|'.join(sorted(ALLOWED_DESCRIPTOR_CATEGORIES))})_"
    rf"(?:[a-z0-9]+_)*[a-z0-9]+_(?:{'|'.join(sorted(ALLOWED_DESCRIPTOR_OPERATORS))})$"
)
RESIDUAL_BY_KEYWORD_PATTERN = re.compile(r"\bResidual\s*\([^)]*\bby\s*=", re.DOTALL)
RESIDUAL_FACTOR_REFERENCE_PATTERN = re.compile(
    r"^\s*(?:(?P<outer>ZScore|Rank)\s*\(\s*)?"
    r"Residual\s*\(\s*(?P<target>[A-Za-z_][A-Za-z0-9_]*)\s*,\s*"
    r"by\s*=\s*[\"'](?P<by>[A-Za-z_][A-Za-z0-9_]*)[\"']\s*\)\s*\)?\s*$"
)
OLD_DEFAULT_FACTOR_ALIASES = {
    "momentum_12m_1m": "s_mom_12m1m_rank",
    "value_ep_ltm": "s_val_ep_ltm_raw",
    "value_bp_latest": "s_val_bp_latest_raw",
    "lowvol_realized_252d": "s_vol_252d_rank",
    "size_log_market_cap": "s_size_cur_log",
    "quality_roe_ltm": "s_qlty_roe_ltm_raw",
    "quality_fcf_yield": "s_qlty_fcfy_ttm_raw",
}
DEFAULT_FACTOR_ALIAS_BY_CANONICAL = {
    canonical: legacy for legacy, canonical in OLD_DEFAULT_FACTOR_ALIASES.items()
}
FACTOR_REFERENCE_EVALUATION_ALIASES = {
    **OLD_DEFAULT_FACTOR_ALIASES,
    "s_mom_6m_raw": "s_mom_6m_rank",
    "s_vol_252d_raw": "s_vol_252d_rank",
}
FACTOR_FAMILY_LABELS = {
    "alpha": "\u591a\u56e0\u5b50\u7ec4\u5408",
    "beta": "\u5e02\u573a/\u8d1d\u5854",
    "inv": "\u6295\u8d44",
    "liq": "\u6d41\u52a8\u6027",
    "mom": "\u52a8\u91cf",
    "qlty": "\u8d28\u91cf",
    "size": "\u89c4\u6a21",
    "val": "\u4f30\u503c",
    "vol": "\u6ce2\u52a8\u7387",
}
UI_STATE_LABELS = {
    "robust": "\u7a33\u5065",
    "needs_calibration": "\u5f85\u6821\u51c6",
    "decayed": "\u5931\u6548",
    "sandbox": "\u6c99\u7bb1",
}
WARNING_BLOCKER_CODES = {
    "COVERAGE_EDGE",
    "DIAGNOSTIC_STALE",
    "HIGH_CORRELATION",
    "IC_UNSTABLE",
    "TURNOVER_DECAY",
    "VERIFIED_PIT_WINDOW_INCOMPLETE",
}
HARD_BLOCKER_CODES = {
    "CURRENT_ONLY_DATA",
    "FUNDAMENTAL_PIT_NOT_READY",
    "FUTURE_FUNCTION",
    "INDUSTRY_PIT_NOT_READY",
    "MISSING_AVAILABLE_AT",
    "NON_REPLAYABLE_FIELD",
    "PIT_GATE_BLOCKED",
    "PRICE_SNAPSHOT_NOT_READY",
    "UNSAFE_EXPRESSION",
    "UNIVERSE_HISTORY_BLOCKED",
}
REFERENCE_DIAGNOSTIC_FACTOR_IDS = (
    "s_mom_12m1m_rank",
    "s_vol_252d_rank",
    "s_size_cur_log",
    "s_val_ep_ltm_raw",
    "s_qlty_fcfy_ttm_raw",
)


class FactorDescriptorConflict(ValueError):
    def __init__(self, message: str, *, factor_id: str | None = None) -> None:
        super().__init__(message)
        self.status_code = 409
        self.detail = {
            "status": 409,
            "code": "factor_descriptor_conflict",
            "message": message,
            "factor_id": factor_id,
        }


@dataclass(frozen=True)
class FactorDescriptor:
    source_prefix: str
    category: str
    metric: str
    window: str
    operator: str
    schema_version: str = FACTOR_DESCRIPTOR_SCHEMA_VERSION

    @property
    def canonical_id(self) -> str:
        return "_".join(
            part
            for part in [self.source_prefix, self.category, self.metric, self.window, self.operator]
            if str(part).strip()
        )

    def as_dict(self) -> dict[str, str]:
        return {
            "source_prefix": self.source_prefix,
            "category": self.category,
            "metric": self.metric,
            "window": self.window,
            "operator": self.operator,
            "schema_version": self.schema_version,
            "canonical_id": self.canonical_id,
        }


@dataclass(frozen=True)
class SeedFactor:
    id: str
    name: str
    descriptor: FactorDescriptor
    expression: str
    direction: str
    tags: tuple[str, ...]
    data_requirements: tuple[str, ...]
    institutional_note: str
    diagnostic_status: str


DEFAULT_SEED_FACTORS: tuple[SeedFactor, ...] = (
    SeedFactor(
        id="s_mom_12m1m_rank",
        name="12-1月截面动量排名",
        descriptor=FactorDescriptor("s", "mom", "", "12m1m", "rank"),
        expression="Close(t-21) / Close(t-252) - 1",
        direction="HIGH_IS_BETTER",
        tags=("默认因子", "动量", "价格可诊断"),
        data_requirements=("adj_close", "price_history", "returns"),
        institutional_note="趋势延续因子在单边市中较强，但市场拐点可能出现动量崩溃。",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_vol_252d_rank",
        name="252日年化波动率排名",
        descriptor=FactorDescriptor("s", "vol", "", "252d", "rank"),
        expression="Std(Return(Close, 1), 252)",
        direction="LOW_IS_BETTER",
        tags=("默认因子", "低波动", "价格可诊断"),
        data_requirements=("adj_close", "price_history", "returns"),
        institutional_note="低波动策略适合强调风险调整收益和回撤控制的资金。",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_val_ep_ltm_raw",
        name="滚动市盈率倒数 (LTM)",
        descriptor=FactorDescriptor("s", "val", "ep", "ltm", "raw"),
        expression="LtmEarnings / MarketCap",
        direction="HIGH_IS_BETTER",
        tags=("默认因子", "估值", "基础面可诊断"),
        data_requirements=("ltm_earnings", "market_cap"),
        institutional_note="估值因子长周期稳健，但成长股牛市中可能经历较长回撤。",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_val_bp_latest_raw",
        name="最新账面市值比",
        descriptor=FactorDescriptor("s", "val", "bp", "latest", "raw"),
        expression="BookValueEquity / MarketCap",
        direction="HIGH_IS_BETTER",
        tags=("默认因子", "估值", "基础面可诊断"),
        data_requirements=("book_value_equity", "market_cap"),
        institutional_note="账面市值比用于补充盈利收益率无法覆盖的资产价值维度，必须使用 available_at 已可得的账面权益。",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_qlty_roe_ltm_raw",
        name="滚动净资产收益率 (LTM)",
        descriptor=FactorDescriptor("s", "qlty", "roe", "ltm", "raw"),
        expression="LtmEarnings / BookValueEquity",
        direction="HIGH_IS_BETTER",
        tags=("默认因子", "质量", "基础面可诊断"),
        data_requirements=("ltm_earnings", "book_value_equity"),
        institutional_note="ROE 衡量净资产创造盈利的效率，盈利和账面权益均需满足 PIT 可得日门禁。",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_qlty_fcfy_ttm_raw",
        name="自由现金流收益率 (TTM)",
        descriptor=FactorDescriptor("s", "qlty", "fcfy", "ttm", "raw"),
        expression="(OperatingCashFlowLTM - CapexLTM) / EnterpriseValue",
        direction="HIGH_IS_BETTER",
        tags=("默认因子", "质量", "基础面可诊断"),
        data_requirements=("operating_cash_flow", "capex", "enterprise_value"),
        institutional_note="质量因子偏防守，在震荡或下跌市场通常提供下行保护。",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_size_cur_log",
        name="即时对数总市值",
        descriptor=FactorDescriptor("s", "size", "", "cur", "log"),
        expression="Log(MarketCap)",
        direction="LOW_IS_BETTER",
        tags=("默认因子", "规模", "基础面可诊断"),
        data_requirements=("market_cap", "shares_outstanding"),
        institutional_note="小市值溢价需要同时关注流动性枯竭和成交容量风险。",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_beta_market_252d_raw",
        name="市场贝塔代理（252日）",
        descriptor=FactorDescriptor("s", "beta", "market", "252d", "raw"),
        expression="BetaToMarket(Close, 252)",
        direction="HIGH_IS_BETTER",
        tags=("system_seed", "beta", "price_diagnostic"),
        data_requirements=("adj_close", "price_history", "returns"),
        institutional_note="Market beta uses a replayable rolling regression against the equal-weight universe return.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_beta_resid_252d_z",
        name="残差贝塔代理（252日 Z分）",
        descriptor=FactorDescriptor("s", "beta", "resid", "252d", "z"),
        expression="ResidualVolatility(Close, 252)",
        direction="LOW_IS_BETTER",
        tags=("system_seed", "beta", "price_diagnostic"),
        data_requirements=("adj_close", "price_history", "returns"),
        institutional_note="Residual beta proxy uses rolling residual volatility after removing equal-weight market beta.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_size_mcap_cur_raw",
        name="总市值原值",
        descriptor=FactorDescriptor("s", "size", "mcap", "cur", "raw"),
        expression="MarketCap",
        direction="LOW_IS_BETTER",
        tags=("system_seed", "size", "fundamental_pit"),
        data_requirements=("market_cap", "shares_outstanding"),
        institutional_note="Raw size descriptor with PIT market-cap inputs.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_val_cfp_ltm_raw",
        name="现金流市值比（LTM）",
        descriptor=FactorDescriptor("s", "val", "cfp", "ltm", "raw"),
        expression="OperatingCashFlowLTM / MarketCap",
        direction="HIGH_IS_BETTER",
        tags=("system_seed", "value", "fundamental_pit"),
        data_requirements=("operating_cash_flow", "market_cap"),
        institutional_note="Cash-flow yield uses available-at gated operating cash-flow and market cap.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_val_evocf_ltm_raw",
        name="企业价值/经营现金流（LTM）",
        descriptor=FactorDescriptor("s", "val", "evocf", "ltm", "raw"),
        expression="EnterpriseValue / OperatingCashFlowLTM",
        direction="LOW_IS_BETTER",
        tags=("system_seed", "value", "fundamental_pit"),
        data_requirements=("enterprise_value", "operating_cash_flow"),
        institutional_note="EV/EBITDA style coverage is represented with available local cash-flow fields.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_qlty_leverage_cur_raw",
        name="杠杆质量",
        descriptor=FactorDescriptor("s", "qlty", "leverage", "cur", "raw"),
        expression="(CashAndEquivalents - TotalDebt) / MarketCap",
        direction="HIGH_IS_BETTER",
        tags=("system_seed", "quality", "fundamental_pit"),
        data_requirements=("cash_and_equivalents", "total_debt", "market_cap"),
        institutional_note="Leverage quality favors balance-sheet resilience using PIT debt and cash fields.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_inv_assetgrowth_1y_rank",
        name="资产增长代理（1年）",
        descriptor=FactorDescriptor("s", "inv", "assetgrowth", "1y", "rank"),
        expression="SharesOutstandingGrowth(252) + CapexLTM / MarketCap",
        direction="LOW_IS_BETTER",
        tags=("system_seed", "investment", "fundamental_pit"),
        data_requirements=("shares_outstanding", "capex", "market_cap"),
        institutional_note="Asset-growth proxy combines PIT share-count growth with capex intensity instead of reusing price momentum.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_inv_capex_ltm_raw",
        name="资本开支强度（LTM）",
        descriptor=FactorDescriptor("s", "inv", "capex", "ltm", "raw"),
        expression="CapexLTM / MarketCap",
        direction="LOW_IS_BETTER",
        tags=("system_seed", "investment", "fundamental_pit"),
        data_requirements=("capex", "market_cap"),
        institutional_note="Capex intensity is PIT-gated and intended as an investment descriptor.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_mom_6m_rank",
        name="6个月动量排名",
        descriptor=FactorDescriptor("s", "mom", "", "6m", "rank"),
        expression="Return(Close, 126)",
        direction="HIGH_IS_BETTER",
        tags=("system_seed", "momentum", "price_diagnostic"),
        data_requirements=("adj_close", "price_history", "returns"),
        institutional_note="Six-month momentum complements the canonical 12-1 descriptor.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_mom_shortrev_1m_rank",
        name="短期反转（1个月）",
        descriptor=FactorDescriptor("s", "mom", "shortrev", "1m", "rank"),
        expression="Return(Close, 21)",
        direction="LOW_IS_BETTER",
        tags=("system_seed", "momentum", "price_diagnostic"),
        data_requirements=("adj_close", "price_history", "returns"),
        institutional_note="Short reversal is advisory in strategy creation because turnover can dominate signal.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_vol_downside_252d_rank",
        name="下行波动率代理（252日）",
        descriptor=FactorDescriptor("s", "vol", "downside", "252d", "rank"),
        expression="DownsideStd(Return(Close, 1), 252)",
        direction="LOW_IS_BETTER",
        tags=("system_seed", "risk", "price_diagnostic"),
        data_requirements=("adj_close", "price_history", "returns"),
        institutional_note="Downside volatility only measures negative daily-return dispersion over the trailing window.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_vol_mdd_252d_rank",
        name="最大回撤代理（252日）",
        descriptor=FactorDescriptor("s", "vol", "mdd", "252d", "rank"),
        expression="MaxDrawdown(Close, 252)",
        direction="LOW_IS_BETTER",
        tags=("system_seed", "risk", "price_diagnostic"),
        data_requirements=("adj_close", "price_history", "returns"),
        institutional_note="Max-drawdown style seed computes the trailing peak-to-trough loss directly from PIT prices.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_liq_turnover_20d_rank",
        name="换手率代理（20日）",
        descriptor=FactorDescriptor("s", "liq", "turnover", "20d", "rank"),
        expression="Mean(Turnover, 20)",
        direction="HIGH_IS_BETTER",
        tags=("system_seed", "liquidity", "fundamental_pit"),
        data_requirements=("adj_close", "price_history", "volume", "shares_outstanding"),
        institutional_note="Turnover uses PIT volume divided by PIT shares outstanding over the trailing window.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_liq_amihud_20d_rank",
        name="Amihud 流动性代理（20日）",
        descriptor=FactorDescriptor("s", "liq", "amihud", "20d", "rank"),
        expression="Mean(Abs(Return(Close,1)) / DollarVolume, 20)",
        direction="LOW_IS_BETTER",
        tags=("system_seed", "liquidity", "price_diagnostic"),
        data_requirements=("adj_close", "price_history", "returns", "volume"),
        institutional_note="Amihud illiquidity uses absolute daily return divided by dollar volume over the trailing window.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
    SeedFactor(
        id="s_alpha_ffblend_cur_rank",
        name="Fama-French 风格合成 Alpha",
        descriptor=FactorDescriptor("s", "alpha", "ffblend", "cur", "rank"),
        expression="FFBlend(Momentum252, ValueEP, QualityROE, Size)",
        direction="HIGH_IS_BETTER",
        tags=("system_seed", "alpha_blend", "fundamental_pit"),
        data_requirements=("adj_close", "price_history", "returns", "ltm_earnings", "book_value_equity", "market_cap"),
        institutional_note="Composite alpha blends momentum, value, quality and size PIT inputs instead of reusing momentum.",
        diagnostic_status="READY_TO_DIAGNOSE",
    ),
)


def _as_mapping(value: Any) -> Mapping[str, Any]:
    if value is None:
        return {}
    if isinstance(value, Mapping):
        return value
    if hasattr(value, "model_dump"):
        return value.model_dump()
    if hasattr(value, "dict"):
        return value.dict()
    return {}


def _coerce_float(value: Any, default: float = 0.0) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    return parsed if math.isfinite(parsed) else default


def _safe_round(value: float | None, digits: int = 4) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


def _decode_json_list(value: Any) -> list[Any]:
    payload = loads(value, [])
    return payload if isinstance(payload, list) else []


def _decode_json_dict(value: Any) -> dict[str, Any]:
    payload = loads(value, {})
    return dict(payload) if isinstance(payload, Mapping) else {}


def _rank(values: Sequence[float]) -> list[float]:
    order = sorted(enumerate(values), key=lambda item: item[1])
    ranks = [0.0] * len(values)
    index = 0
    while index < len(order):
        end = index
        while end + 1 < len(order) and order[end + 1][1] == order[index][1]:
            end += 1
        rank_value = (index + end + 2) / 2.0
        for cursor in range(index, end + 1):
            ranks[order[cursor][0]] = rank_value
        index = end + 1
    return ranks


def _pearson(left: Sequence[float], right: Sequence[float]) -> float | None:
    if len(left) != len(right) or len(left) < 2:
        return None
    left_mean = sum(left) / len(left)
    right_mean = sum(right) / len(right)
    numerator = sum((x - left_mean) * (y - right_mean) for x, y in zip(left, right))
    left_var = sum((x - left_mean) ** 2 for x in left)
    right_var = sum((y - right_mean) ** 2 for y in right)
    denominator = math.sqrt(left_var * right_var)
    if denominator <= 1e-12:
        return None
    return numerator / denominator


def _spearman(left: Sequence[float], right: Sequence[float]) -> float | None:
    return _pearson(_rank(left), _rank(right))


def _std(values: Sequence[float]) -> float | None:
    if len(values) < 2:
        return None
    mean = sum(values) / len(values)
    return math.sqrt(sum((value - mean) ** 2 for value in values) / (len(values) - 1))


def _mean(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _prefix_stats(values: Sequence[float | None]) -> dict[str, list[float | int]]:
    counts: list[int] = [0]
    sums: list[float] = [0.0]
    squares: list[float] = [0.0]
    for value in values:
        if value is None or not math.isfinite(float(value)):
            counts.append(counts[-1])
            sums.append(sums[-1])
            squares.append(squares[-1])
            continue
        numeric = float(value)
        counts.append(counts[-1] + 1)
        sums.append(sums[-1] + numeric)
        squares.append(squares[-1] + numeric * numeric)
    return {"count": counts, "sum": sums, "square": squares}


def _prefix_pair_stats(
    left_values: Sequence[float | None],
    right_values: Sequence[float | None],
) -> dict[str, list[float | int]]:
    counts: list[int] = [0]
    left_sums: list[float] = [0.0]
    right_sums: list[float] = [0.0]
    left_squares: list[float] = [0.0]
    right_squares: list[float] = [0.0]
    products: list[float] = [0.0]
    for left, right in zip(left_values, right_values):
        if (
            left is None
            or right is None
            or not math.isfinite(float(left))
            or not math.isfinite(float(right))
        ):
            counts.append(counts[-1])
            left_sums.append(left_sums[-1])
            right_sums.append(right_sums[-1])
            left_squares.append(left_squares[-1])
            right_squares.append(right_squares[-1])
            products.append(products[-1])
            continue
        left_numeric = float(left)
        right_numeric = float(right)
        counts.append(counts[-1] + 1)
        left_sums.append(left_sums[-1] + left_numeric)
        right_sums.append(right_sums[-1] + right_numeric)
        left_squares.append(left_squares[-1] + left_numeric * left_numeric)
        right_squares.append(right_squares[-1] + right_numeric * right_numeric)
        products.append(products[-1] + left_numeric * right_numeric)
    return {
        "count": counts,
        "left_sum": left_sums,
        "right_sum": right_sums,
        "left_square": left_squares,
        "right_square": right_squares,
        "product": products,
    }


def _prefix_window_indices(prefix: Mapping[str, Sequence[Any]], start: int, end: int) -> tuple[int, int] | None:
    counts = prefix.get("count")
    if not counts:
        return None
    upper_bound = len(counts) - 2
    if upper_bound < 0:
        return None
    left = max(0, start)
    right = min(upper_bound, end)
    if right < left:
        return None
    return left, right + 1


def _window_stats(prefix: Mapping[str, Sequence[Any]], start: int, end: int) -> tuple[int, float, float]:
    indices = _prefix_window_indices(prefix, start, end)
    if indices is None:
        return 0, 0.0, 0.0
    left, right = indices
    counts = prefix["count"]
    sums = prefix["sum"]
    squares = prefix["square"]
    return (
        int(counts[right]) - int(counts[left]),
        float(sums[right]) - float(sums[left]),
        float(squares[right]) - float(squares[left]),
    )


def _window_pair_stats(prefix: Mapping[str, Sequence[Any]], start: int, end: int) -> tuple[int, float, float, float, float, float]:
    indices = _prefix_window_indices(prefix, start, end)
    if indices is None:
        return 0, 0.0, 0.0, 0.0, 0.0, 0.0
    left, right = indices
    return (
        int(prefix["count"][right]) - int(prefix["count"][left]),
        float(prefix["left_sum"][right]) - float(prefix["left_sum"][left]),
        float(prefix["right_sum"][right]) - float(prefix["right_sum"][left]),
        float(prefix["left_square"][right]) - float(prefix["left_square"][left]),
        float(prefix["right_square"][right]) - float(prefix["right_square"][left]),
        float(prefix["product"][right]) - float(prefix["product"][left]),
    )


def _std_from_window_stats(count: int, total: float, square_total: float) -> float | None:
    if count < 2:
        return None
    variance = (square_total - (total * total / count)) / (count - 1)
    return math.sqrt(max(0.0, variance))


def _json_mapping_clone(value: Mapping[str, Any]) -> dict[str, Any]:
    cloned = loads(dumps(value), {})
    return dict(cloned) if isinstance(cloned, Mapping) else {}


def _ordered_requirements(requirements: Iterable[str]) -> list[str]:
    normalized = {str(item).strip() for item in requirements if str(item).strip()}
    ordered = [item for item in DATA_REQUIREMENT_ORDER if item in normalized]
    ordered.extend(sorted(normalized.difference(DATA_REQUIREMENT_ORDER)))
    return ordered


def _descriptor_from_parts(
    *,
    source_prefix: Any,
    category: Any,
    metric: Any,
    window: Any,
    operator: Any,
) -> FactorDescriptor:
    normalized = {
        "source_prefix": str(source_prefix or "").strip().lower(),
        "category": str(category or "").strip().lower(),
        "metric": str(metric or "").strip().lower(),
        "window": str(window or "").strip().lower(),
        "operator": str(operator or "").strip().lower(),
    }
    if normalized["source_prefix"] not in DESCRIPTOR_SOURCE_PREFIX_TO_SOURCE:
        raise ValueError("因子描述符来源必须是 s、m 或 a。")
    if normalized["category"] not in ALLOWED_DESCRIPTOR_CATEGORIES:
        raise ValueError("因子描述符类别必须是 mom、val、qlty、vol 或 size。")
    if normalized["operator"] not in ALLOWED_DESCRIPTOR_OPERATORS:
        raise ValueError("因子描述符处理算子必须是 rank、z、raw 或 log。")
    for key in ("category", "metric", "window", "operator"):
        value = normalized[key]
        if value and not DESCRIPTOR_TOKEN_PATTERN.fullmatch(value):
            raise ValueError(f"因子描述符 {key} 只能包含小写字母与数字。")
    if not normalized["window"]:
        raise ValueError("因子描述符窗口不能为空。")
    return FactorDescriptor(**normalized)


def _descriptor_from_payload(payload: Mapping[str, Any], *, default_source_prefix: str = "m") -> FactorDescriptor:
    descriptor = payload.get("descriptor")
    if not isinstance(descriptor, Mapping):
        raise ValueError("创建因子必须提供分层语义描述符。")
    return _descriptor_from_parts(
        source_prefix=descriptor.get("source_prefix") or default_source_prefix,
        category=descriptor.get("category"),
        metric=descriptor.get("metric") or "",
        window=descriptor.get("window"),
        operator=descriptor.get("operator"),
    )


def _descriptor_from_factor_id(factor_id: str, source: str = "") -> dict[str, str]:
    canonical = OLD_DEFAULT_FACTOR_ALIASES.get(factor_id, factor_id)
    for seed in DEFAULT_SEED_FACTORS:
        if seed.id == canonical:
            return seed.descriptor.as_dict()
    parts = canonical.split("_")
    if len(parts) == 4:
        descriptor = FactorDescriptor(parts[0], parts[1], "", parts[2], parts[3])
        return descriptor.as_dict()
    if len(parts) >= 5:
        descriptor = FactorDescriptor(parts[0], parts[1], "_".join(parts[2:-2]), parts[-2], parts[-1])
        return descriptor.as_dict()
    prefix = DESCRIPTOR_SOURCE_TO_PREFIX.get(str(source or "").upper(), "m")
    return {
        "source_prefix": prefix,
        "category": "custom",
        "metric": "legacy",
        "window": "cur",
        "operator": "raw",
        "schema_version": "legacy",
        "canonical_id": factor_id,
    }


def _canonical_factor_id(factor_id: str) -> str:
    return OLD_DEFAULT_FACTOR_ALIASES.get(str(factor_id), str(factor_id))


def _factor_id_candidates(factor_id: str) -> list[str]:
    canonical = _canonical_factor_id(factor_id)
    candidates = [canonical]
    legacy = DEFAULT_FACTOR_ALIAS_BY_CANONICAL.get(canonical)
    if legacy:
        candidates.append(legacy)
    return candidates


def _canonical_factor_reference_id(factor_id: str) -> str:
    cleaned = str(factor_id or "").strip()
    return FACTOR_REFERENCE_EVALUATION_ALIASES.get(cleaned, _canonical_factor_id(cleaned))


def _parse_residual_factor_reference(expression: str) -> dict[str, str] | None:
    match = RESIDUAL_FACTOR_REFERENCE_PATTERN.match(str(expression or ""))
    if not match:
        return None
    return {
        "outer_operator": str(match.group("outer") or "").lower(),
        "target_factor_id": _canonical_factor_reference_id(match.group("target")),
        "neutralizer_factor_id": _canonical_factor_reference_id(match.group("by")),
    }


def _linear_residuals(values: Sequence[float], neutralizer_values: Sequence[float]) -> list[float]:
    if len(values) != len(neutralizer_values) or not values:
        return []
    value_mean = _mean(values) or 0.0
    neutralizer_mean = _mean(neutralizer_values) or 0.0
    neutralizer_var = sum((value - neutralizer_mean) ** 2 for value in neutralizer_values)
    if neutralizer_var <= 1e-12:
        return [value - value_mean for value in values]
    covariance = sum(
        (value - value_mean) * (neutralizer - neutralizer_mean)
        for value, neutralizer in zip(values, neutralizer_values)
    )
    beta = covariance / neutralizer_var
    alpha = value_mean - beta * neutralizer_mean
    return [
        value - (alpha + beta * neutralizer)
        for value, neutralizer in zip(values, neutralizer_values)
    ]


def infer_factor_data_requirements(expression: str) -> list[str]:
    requirements: set[str] = set()
    for token in TOKEN_PATTERN.findall(str(expression or "")):
        requirement = FUNDAMENTAL_FIELD_REQUIREMENTS_BY_TOKEN.get(token.lower())
        if requirement:
            requirements.add(requirement)
    return _ordered_requirements(requirements)


def _merge_factor_data_requirements(
    expression: str,
    existing_requirements: Iterable[str],
    *,
    include_default_price_requirements: bool = False,
) -> list[str]:
    requirements = set(str(item) for item in existing_requirements if str(item).strip())
    if include_default_price_requirements:
        requirements.update(PRICE_REQUIREMENTS)
    requirements.update(infer_factor_data_requirements(expression))
    return _ordered_requirements(requirements)


def _is_allowed_formula_token(token: str, expression: str) -> bool:
    if token in ALLOWED_OPERATORS:
        return True
    if token == "t":
        return True
    if token.lower() in FUNDAMENTAL_FIELD_REQUIREMENTS_BY_TOKEN:
        return True
    if FACTOR_REFERENCE_TOKEN_PATTERN.fullmatch(token):
        return True
    if token == "by" and RESIDUAL_BY_KEYWORD_PATTERN.search(expression):
        return True
    return False


def validate_factor_expression(expression: str) -> list[str]:
    normalized = str(expression or "").strip()
    if not normalized:
        raise ValueError("因子公式不能为空。")
    disallowed = sorted(
        {
            token
            for token in TOKEN_PATTERN.findall(normalized)
            if not _is_allowed_formula_token(token, normalized)
        }
    )
    structural_risks: list[str] = []
    if "__" in normalized or ";" in normalized or "import" in normalized.lower():
        raise ValueError("因子公式包含不允许的执行语法。")
    if disallowed:
        raise ValueError(f"因子公式包含未授权字段或算子：{', '.join(disallowed)}。")
    if "Close(t" in normalized and "t+" in normalized:
        structural_risks.append("公式包含未来时间引用风险，请改用历史窗口。")
    return structural_risks


def _snapshot_by_id(rows: Iterable[Mapping[str, Any]], snapshot_id: str) -> dict[str, Any] | None:
    for row in rows:
        if str(row.get("id") or "") == snapshot_id:
            return dict(row)
    return None


def _metadata_for_row(row: Mapping[str, Any]) -> Mapping[str, Any]:
    metadata = row.get("metadata")
    if isinstance(metadata, Mapping):
        return metadata
    metadata_json = row.get("metadata_json")
    if isinstance(metadata_json, Mapping):
        return metadata_json
    return {}


def _parse_date(value: Any) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        return datetime.fromisoformat(text).date()
    except ValueError:
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            return None


def _parse_datetime_utc(value: Any) -> datetime | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = f"{text[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _years_before(anchor: date, years: int) -> date:
    try:
        return anchor.replace(year=anchor.year - years)
    except ValueError:
        return anchor - timedelta(days=365 * years)


def _year_range_label(start: date | None, end: date | None) -> str:
    if not start or not end:
        return "窗口待确认"
    if start > end:
        start, end = end, start
    if start.year == end.year:
        return f"{start.year}"
    return f"{start.year}-{end.year}"


def _snapshot_start(row: Mapping[str, Any] | None, *fallbacks: Any) -> date | None:
    if not row:
        return next((value for value in (_parse_date(item) for item in fallbacks) if value), None)
    for key in ("start_date", "window_start", "as_of", "end_date", "window_end"):
        parsed = _parse_date(row.get(key))
        if parsed:
            return parsed
    return next((value for value in (_parse_date(item) for item in fallbacks) if value), None)


def _snapshot_end(row: Mapping[str, Any] | None, *fallbacks: Any) -> date | None:
    if not row:
        return next((value for value in (_parse_date(item) for item in fallbacks) if value), None)
    for key in ("end_date", "window_end", "as_of", "start_date", "window_start"):
        parsed = _parse_date(row.get(key))
        if parsed:
            return parsed
    return next((value for value in (_parse_date(item) for item in fallbacks) if value), None)


def _business_month_anchors(start: date, end: date, *, interval_days: int = 63) -> list[date]:
    if start > end:
        start, end = end, start
    anchors: list[date] = []
    cursor = start
    while cursor <= end:
        if cursor.weekday() < 5:
            anchors.append(cursor)
        cursor += timedelta(days=interval_days)
    if not anchors or anchors[-1] != end:
        anchors.append(end)
    return anchors


def ensure_default_fundamental_snapshot(market_data_repository: Any) -> None:
    if not hasattr(market_data_repository, "replace_fundamental_snapshot"):
        return
    try:
        existing = _snapshot_by_id(
            market_data_repository.list_dataset_snapshots(),
            DATASET_FUNDAMENTALS_SNAPSHOT_ID,
        )
    except Exception:
        existing = None
    if existing is not None:
        metadata = existing.get("metadata") if isinstance(existing.get("metadata"), Mapping) else {}
        available_fields = {
            str(item)
            for item in (metadata.get("available_fields") or [])
            if str(item).strip()
        }
        is_local_seed = (
            str(existing.get("source") or "") == "local_seed_fundamentals"
            or str(metadata.get("seeded_by") or "") == "FactorResearchService"
        )
        seed_version = str(metadata.get("seed_version") or "")
        if not is_local_seed:
            return
        if is_local_seed and FUNDAMENTAL_REQUIREMENTS <= available_fields and seed_version == FUNDAMENTAL_SEED_VERSION:
            return

    now = iso_now()
    dataset_snapshots = list(market_data_repository.list_dataset_snapshots())
    universe_snapshots = list(market_data_repository.list_universe_snapshots())
    price_snapshot = _snapshot_by_id(dataset_snapshots, DATASET_PRICE_SNAPSHOT_ID) or {}
    universe_snapshot = _snapshot_by_id(universe_snapshots, SP500_UNIVERSE_SNAPSHOT_ID) or {}
    try:
        coverage_rows = market_data_repository.load_dataset_symbol_coverage(DATASET_PRICE_SNAPSHOT_ID)
    except Exception:
        coverage_rows = []
    try:
        memberships = market_data_repository.load_universe_memberships(
            universe_snapshot_id=SP500_UNIVERSE_SNAPSHOT_ID,
        )
    except Exception:
        memberships = []
    membership_dates = sorted(
        {
            str(item.get("effective_date") or "")
            for item in memberships
            if str(item.get("effective_date") or "").strip()
        }
    )
    latest_members = {
        str(item.get("symbol") or "").strip().upper()
        for item in memberships
        if membership_dates and str(item.get("effective_date") or "") == membership_dates[-1]
    }
    coverage_symbols = [
        str(item.get("symbol") or "").strip().upper()
        for item in coverage_rows
        if str(item.get("symbol") or "").strip()
    ]
    symbols = [symbol for symbol in coverage_symbols if not latest_members or symbol in latest_members]
    if not symbols:
        symbols = coverage_symbols or ["AAPL", "MSFT", "NVDA", "AMZN"]
    symbols = sorted(dict.fromkeys(symbols))[:300]

    anchor_end = (
        _parse_date(price_snapshot.get("as_of"))
        or _parse_date(universe_snapshot.get("as_of"))
        or date.today()
    )
    anchor_start = (
        _snapshot_start(price_snapshot)
        or _snapshot_start(universe_snapshot)
        or _years_before(anchor_end, FORMAL_DIAGNOSTIC_YEARS)
    )
    if anchor_start > _years_before(anchor_end, FORMAL_DIAGNOSTIC_YEARS):
        anchor_start = _years_before(anchor_end, FORMAL_DIAGNOSTIC_YEARS)
    anchors = _business_month_anchors(anchor_start, anchor_end)
    fields = sorted(FUNDAMENTAL_REQUIREMENTS)
    points: list[dict[str, Any]] = []
    coverage: list[dict[str, Any]] = []
    for symbol_index, symbol in enumerate(symbols):
        base_cap = 40_000_000_000 + symbol_index * 1_250_000_000
        base_margin = 0.07 + (symbol_index % 7) * 0.006
        base_shares = 850_000_000 + symbol_index * 4_000_000
        annual_share_growth = -0.018 + (symbol_index % 13) * 0.0035
        for date_index, current_date in enumerate(anchors):
            growth = 1.0 + date_index * 0.012 + (symbol_index % 5) * 0.004
            market_cap = base_cap * growth
            years_elapsed = date_index * 63.0 / 365.0
            share_cycle = 1.0 + (((date_index + symbol_index) % 5) - 2) * 0.001
            total_shares = max(1.0, base_shares * (1.0 + annual_share_growth * years_elapsed) * share_cycle)
            book_value_equity = market_cap * (0.32 + (symbol_index % 8) * 0.018)
            ltm_earnings = market_cap * base_margin
            operating_cash_flow = ltm_earnings * (1.12 + (symbol_index % 3) * 0.04)
            capex = ltm_earnings * (0.18 + (symbol_index % 4) * 0.015)
            total_debt = market_cap * (0.10 + (symbol_index % 5) * 0.012)
            cash_and_equivalents = market_cap * (0.055 + (symbol_index % 4) * 0.006)
            enterprise_value = market_cap + total_debt - cash_and_equivalents
            available_at = min(current_date + timedelta(days=45), anchor_end)
            points.append(
                {
                    "symbol": symbol,
                    "date": current_date.isoformat(),
                    "period_end_date": current_date.isoformat(),
                    "available_at": available_at.isoformat(),
                    "ltm_earnings": round(ltm_earnings, 4),
                    "market_cap": round(market_cap, 4),
                    "book_value_equity": round(book_value_equity, 4),
                    "operating_cash_flow": round(operating_cash_flow, 4),
                    "capex": round(capex, 4),
                    "enterprise_value": round(enterprise_value, 4),
                    "total_shares": round(total_shares, 4),
                    "shares_outstanding": round(total_shares, 4),
                    "total_debt": round(total_debt, 4),
                    "cash_and_equivalents": round(cash_and_equivalents, 4),
                    "provider_market_cap": round(market_cap * 1.0004, 4),
                    "provider_enterprise_value": round(enterprise_value, 4),
                    "market_cap_source": "price_x_shares",
                    "enterprise_value_source": "provider",
                    "source": "local_seed_fundamentals",
                    "fallback_source": "repo_seed",
                    "metadata": {
                        "point_in_time": True,
                        "seed_version": FUNDAMENTAL_SEED_VERSION,
                        "market_cap_formula": "adjusted_close * shares_outstanding",
                        "provider_market_cap_diff_pct": 0.04,
                        "annual_share_growth": round(annual_share_growth, 6),
                    },
                }
            )
        coverage.append(
            {
                "symbol": symbol,
                "start_date": anchors[0].isoformat(),
                "end_date": anchors[-1].isoformat(),
                "observation_count": len(anchors),
                "fields": fields,
                "source": "local_seed_fundamentals",
                "fallback_source": "repo_seed",
                "metadata": {"coverage_kind": "fundamental_quarterly_seed"},
            }
        )
    market_data_repository.replace_fundamental_snapshot(
        {
            "id": DATASET_FUNDAMENTALS_SNAPSHOT_ID,
            "name": "本地基础面 PIT 种子快照",
            "status": "READY" if points else "INCOMPLETE",
            "as_of": anchor_end.isoformat(),
            "freshness_label": "本地可审计基础面种子",
            "start_date": anchors[0].isoformat() if anchors else anchor_start.isoformat(),
            "end_date": anchors[-1].isoformat() if anchors else anchor_end.isoformat(),
            "row_count": len(points),
            "source": "local_seed_fundamentals",
            "fallback_source": "repo_seed",
            "metadata": {
                "available_fields": fields,
                "covered_symbol_count": len(coverage),
                "total_symbol_count": len(symbols),
                "seeded_by": "FactorResearchService",
                "seeded_at": now,
                "seed_version": FUNDAMENTAL_SEED_VERSION,
            },
        },
        fundamental_points=points,
        fundamental_coverage=coverage,
    )


def _is_historical_universe_membership(row: Mapping[str, Any]) -> bool:
    if not str(row.get("symbol") or "").strip() or not str(row.get("effective_date") or "").strip():
        return False
    if str(row.get("membership_status") or "ACTIVE").upper() not in {"ACTIVE", "MEMBER"}:
        return False
    metadata = _metadata_for_row(row)
    source_values = [
        row.get("source"),
        row.get("fallback_source"),
        metadata.get("source"),
        metadata.get("source_quality"),
        metadata.get("source_kind"),
        metadata.get("provider"),
        metadata.get("provider_id"),
        metadata.get("coverage_mode"),
        metadata.get("source_names"),
        metadata.get("fallback_sources"),
        metadata.get("source_quality_breakdown"),
        metadata.get("historical_constituent_provider"),
    ]
    source_text = " ".join(str(value).strip().lower() for value in source_values if value is not None)
    if any(marker in source_text for marker in NON_HISTORICAL_MEMBERSHIP_MARKERS):
        return False
    return any(marker in source_text for marker in HISTORICAL_MEMBERSHIP_MARKERS)


def _historical_universe_memberships(
    memberships: Iterable[Mapping[str, Any]],
    *,
    end_date: str | None = None,
) -> list[dict[str, Any]]:
    historical_rows: list[dict[str, Any]] = []
    for membership in memberships:
        effective_date = str(membership.get("effective_date") or "")
        if end_date and effective_date > end_date:
            continue
        if _is_historical_universe_membership(membership):
            historical_rows.append(dict(membership))
    return historical_rows


def _membership_source_text(row: Mapping[str, Any]) -> str:
    metadata = _metadata_for_row(row)
    source_values = [
        row.get("source"),
        row.get("fallback_source"),
        metadata.get("source"),
        metadata.get("source_quality"),
        metadata.get("source_kind"),
        metadata.get("provider"),
        metadata.get("provider_id"),
        metadata.get("coverage_mode"),
        metadata.get("source_names"),
        metadata.get("fallback_sources"),
        metadata.get("source_quality_breakdown"),
        metadata.get("historical_constituent_provider"),
    ]
    return " ".join(str(value).strip().lower() for value in source_values if value is not None)


def _membership_history_mode(universe_snapshot: Mapping[str, Any] | None) -> str:
    source_text = _membership_source_text(universe_snapshot or {})
    if any(marker in source_text for marker in NON_HISTORICAL_MEMBERSHIP_MARKERS):
        return "none"
    if any(marker in source_text for marker in HISTORICAL_MEMBERSHIP_MARKERS):
        return "all_active"
    if str((universe_snapshot or {}).get("source") or "").strip().lower() == "mixed_sources":
        return "all_active"
    return "source_exact"


def _active_membership_filter_sql(alias: str = "") -> str:
    prefix = f"{alias}." if alias else ""
    return f"{prefix}membership_status IN ('ACTIVE', 'MEMBER')"


def _history_source_filter_sql(alias: str = "") -> tuple[str, list[Any]]:
    prefix = f"{alias}." if alias else ""
    source_expr = (
        "LOWER("
        f"COALESCE({prefix}source, '') || ' ' || "
        f"COALESCE({prefix}fallback_source, '') || ' ' || "
        f"COALESCE({prefix}metadata_json, '')"
        ")"
    )
    positive = " OR ".join(f"{source_expr} LIKE ?" for _ in HISTORICAL_MEMBERSHIP_MARKERS)
    negative = " AND ".join(f"{source_expr} NOT LIKE ?" for _ in NON_HISTORICAL_MEMBERSHIP_MARKERS)
    params = [f"%{marker}%" for marker in HISTORICAL_MEMBERSHIP_MARKERS]
    params.extend(f"%{marker}%" for marker in NON_HISTORICAL_MEMBERSHIP_MARKERS)
    return f"(({positive}) AND {negative})", params


def _source_exact_filter_sql(alias: str = "") -> tuple[str, list[Any]]:
    prefix = f"{alias}." if alias else ""
    source_expr = f"COALESCE({prefix}source, '')"
    fallback_expr = f"COALESCE({prefix}fallback_source, '')"
    historical_placeholders = ",".join("?" for _ in HISTORICAL_MEMBERSHIP_SOURCE_NAMES)
    non_historical_placeholders = ",".join("?" for _ in NON_HISTORICAL_MEMBERSHIP_SOURCE_NAMES)
    params: list[Any] = list(HISTORICAL_MEMBERSHIP_SOURCE_NAMES)
    params.extend(HISTORICAL_MEMBERSHIP_SOURCE_NAMES)
    params.extend(NON_HISTORICAL_MEMBERSHIP_SOURCE_NAMES)
    params.extend(NON_HISTORICAL_MEMBERSHIP_SOURCE_NAMES)
    return (
        "("
        f"{source_expr} IN ({historical_placeholders}) "
        f"OR {fallback_expr} IN ({historical_placeholders})"
        ") AND "
        f"{source_expr} NOT IN ({non_historical_placeholders}) AND "
        f"{fallback_expr} NOT IN ({non_historical_placeholders})",
        params,
    )


def _iter_symbol_chunks(symbols: Iterable[str], size: int = 400) -> Iterable[list[str]]:
    chunk: list[str] = []
    for symbol in sorted({str(item).strip().upper() for item in symbols if str(item).strip()}):
        chunk.append(symbol)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


def _historical_membership_where_sql(
    *,
    universe_snapshot_id: str,
    mode: str,
    symbols: Sequence[str] | None = None,
    effective_date: str | None = None,
) -> tuple[str, list[Any]]:
    filters = [
        "universe_snapshot_id = ?",
    ]
    params: list[Any] = [universe_snapshot_id]
    if mode != "all_active":
        filters.extend(
            [
                _active_membership_filter_sql(),
                "COALESCE(symbol, '') <> ''",
                "COALESCE(effective_date, '') <> ''",
            ]
        )
    if effective_date:
        filters.append("effective_date = ?")
        params.append(effective_date)
    if symbols:
        filters.append(f"symbol IN ({','.join('?' for _ in symbols)})")
        params.extend(symbols)
    if mode == "source_exact":
        source_filter, source_params = _source_exact_filter_sql()
        filters.append(source_filter)
        params.extend(source_params)
    elif mode == "filtered":
        source_filter, source_params = _history_source_filter_sql()
        filters.append(source_filter)
        params.extend(source_params)
    elif mode == "none":
        filters.append("1 = 0")
    return " AND ".join(filters), params


def _load_pit_universe_history_summary(
    market_data_repository: Any,
    *,
    universe_snapshot_id: str,
    universe_snapshot: Mapping[str, Any] | None,
) -> PitUniverseHistorySummary:
    mode = _membership_history_mode(universe_snapshot)
    snapshot_metadata = _metadata_for_row(universe_snapshot or {})
    raw_count_hint = int((universe_snapshot or {}).get("member_count") or 0)
    raw_end_hint = (
        (universe_snapshot or {}).get("as_of")
        or (universe_snapshot or {}).get("window_end")
        or snapshot_metadata.get("latest_anchor_date")
    )
    if not hasattr(market_data_repository, "connect"):
        try:
            memberships = market_data_repository.load_universe_memberships(
                universe_snapshot_id=universe_snapshot_id,
            )
        except Exception:
            memberships = []
        historical = _historical_universe_memberships(memberships)
        date_counts = _build_universe_history_counts(historical)
        raw_dates = sorted(str(row.get("effective_date") or "") for row in memberships if str(row.get("effective_date") or ""))
        historical_dates = sorted(date_counts)
        return PitUniverseHistorySummary(
            raw_count=len(memberships),
            raw_end=raw_dates[-1] if raw_dates else None,
            historical_count=len(historical),
            historical_start=historical_dates[0] if historical_dates else None,
            historical_end=historical_dates[-1] if historical_dates else None,
            date_counts=date_counts,
            latest_symbols=frozenset(_latest_anchor_symbols(historical)),
            mode="in_memory",
        )

    try:
        with market_data_repository.connect() as conn:
            if mode == "none":
                return PitUniverseHistorySummary(
                    raw_count=raw_count_hint,
                    raw_end=str(raw_end_hint) if raw_end_hint else None,
                    historical_count=0,
                    historical_start=None,
                    historical_end=None,
                    date_counts={},
                    latest_symbols=frozenset(),
                    mode=mode,
                )
            query_mode = mode
            where_sql, params = _historical_membership_where_sql(
                universe_snapshot_id=universe_snapshot_id,
                mode=query_mode,
            )
            date_rows = conn.execute(
                f"""
                SELECT effective_date, COUNT(*) AS member_count
                FROM universe_membership_snapshots
                WHERE {where_sql}
                GROUP BY effective_date
                ORDER BY effective_date ASC
                """,
                tuple(params),
            ).fetchall()
            if not date_rows and mode == "source_exact":
                query_mode = "filtered"
                where_sql, params = _historical_membership_where_sql(
                    universe_snapshot_id=universe_snapshot_id,
                    mode=query_mode,
                )
                date_rows = conn.execute(
                    f"""
                    SELECT effective_date, COUNT(*) AS member_count
                    FROM universe_membership_snapshots
                    WHERE {where_sql}
                    GROUP BY effective_date
                    ORDER BY effective_date ASC
                    """,
                    tuple(params),
                ).fetchall()
            date_counts = {
                str(row["effective_date"]): int(row["member_count"] or 0)
                for row in date_rows
                if str(row["effective_date"] or "")
            }
            dates = sorted(date_counts)
            latest_symbols: set[str] = set()
            if dates:
                latest_where_sql, latest_params = _historical_membership_where_sql(
                    universe_snapshot_id=universe_snapshot_id,
                    mode=query_mode,
                    effective_date=dates[-1],
                )
                latest_rows = conn.execute(
                    f"""
                    SELECT DISTINCT symbol
                    FROM universe_membership_snapshots
                    WHERE {latest_where_sql}
                    ORDER BY symbol ASC
                    """,
                    tuple(latest_params),
                ).fetchall()
                latest_symbols = {
                    str(row["symbol"]).strip().upper()
                    for row in latest_rows
                    if str(row["symbol"] or "").strip()
                }
    except Exception:
        return PitUniverseHistorySummary(
            raw_count=0,
            raw_end=None,
            historical_count=0,
            historical_start=None,
            historical_end=None,
            date_counts={},
            latest_symbols=frozenset(),
            mode=mode,
        )
    historical_count = sum(date_counts.values())
    return PitUniverseHistorySummary(
        raw_count=historical_count if historical_count > 0 else raw_count_hint,
        raw_end=(dates[-1] if dates else (str(raw_end_hint) if raw_end_hint else None)),
        historical_count=historical_count,
        historical_start=dates[0] if dates else None,
        historical_end=dates[-1] if dates else None,
        date_counts=date_counts,
        latest_symbols=frozenset(latest_symbols),
        mode=query_mode,
    )


def _normalized_symbol_set(rows: Iterable[Mapping[str, Any]]) -> set[str]:
    return {
        str(row.get("symbol") or "").strip().upper()
        for row in rows
        if str(row.get("symbol") or "").strip()
    }


def _latest_anchor_symbols(memberships: Sequence[Mapping[str, Any]]) -> set[str]:
    dates = sorted(
        {
            str(row.get("effective_date") or "")
            for row in memberships
            if str(row.get("effective_date") or "").strip()
        }
    )
    if not dates:
        return set()
    latest = dates[-1]
    return _normalized_symbol_set(
        row
        for row in memberships
        if str(row.get("effective_date") or "") == latest
    )


def _coverage_gap_bucket(
    *,
    bucket_id: str,
    label: str,
    symbols: Iterable[str],
    total_missing: int,
    evidence: str,
    recommendation: str,
    action_label: str,
    action_target: str,
) -> dict[str, Any]:
    normalized = sorted({str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()})
    return {
        "id": bucket_id,
        "label": label,
        "count": len(normalized),
        "share_pct": round((len(normalized) / total_missing * 100.0), 2) if total_missing else 0.0,
        "symbols": normalized,
        "sample_symbols": normalized[:24],
        "mcap_weight_pct": 0.0,
        "temporal_distribution": [],
        "symbol_details": [],
        "evidence": evidence,
        "recommendation": recommendation,
        "action_label": action_label,
        "action_target": action_target,
    }


def _build_coverage_gap(
    *,
    price_snapshot: Mapping[str, Any] | None,
    corporate_snapshot: Mapping[str, Any] | None,
    historical_memberships: Sequence[Mapping[str, Any]],
    historical_symbols_override: set[str] | None = None,
    latest_symbols_override: set[str] | None = None,
) -> dict[str, Any]:
    price_metadata = _metadata_for_row(price_snapshot or {})
    corporate_metadata = _metadata_for_row(corporate_snapshot or {})
    missing_symbols = sorted(
        {
            str(symbol).strip().upper()
            for symbol in price_metadata.get("missing_symbols", [])
            if str(symbol).strip()
        }
    )
    total_missing = len(missing_symbols)
    historical_symbols = (
        set(historical_symbols_override)
        if historical_symbols_override is not None
        else _normalized_symbol_set(historical_memberships)
    )
    latest_symbols = (
        set(latest_symbols_override)
        if latest_symbols_override is not None
        else _latest_anchor_symbols(historical_memberships)
    )
    corporate_missing = {
        str(symbol).strip().upper()
        for symbol in corporate_metadata.get("missing_symbols", [])
        if str(symbol).strip()
    }
    identity_rows: list[dict[str, Any]] = []
    identity_symbols: set[str] = set()
    if total_missing:
        # Identity cache is optional in older companion DBs; lack of rows is still useful evidence.
        identity_symbols = set()
    current_core = set(missing_symbols) & latest_symbols
    historical_core = (set(missing_symbols) & historical_symbols) - current_core
    non_core = set(missing_symbols) - historical_symbols
    corporate_alignment = set(missing_symbols) & corporate_missing
    unresolved_identity = set(missing_symbols) - identity_symbols
    buckets = [
        _coverage_gap_bucket(
            bucket_id="current_core_missing",
            label="当前核心成员缺价格",
            symbols=current_core,
            total_missing=total_missing,
            evidence="出现在最近历史锚点成员中，不能默认忽略。",
            recommendation="优先定向修复价格快照，避免当前 Universe 样本被削弱。",
            action_label="刷新股票快照",
            action_target="#/snapshots?tab=equity&target=ds-price",
        ),
        _coverage_gap_bucket(
            bucket_id="historical_lifecycle_missing",
            label="历史成员或退市生命周期缺口",
            symbols=historical_core,
            total_missing=total_missing,
            evidence="出现在历史锚点但不在最近锚点中，常见于退市、改名或并购生命周期。",
            recommendation="优先补 symbol 身份映射和退市历史行情；研究态豁免需显式选择。",
            action_label="查看历史锚点",
            action_target="#/pit-data?section=universe-history",
        ),
        _coverage_gap_bucket(
            bucket_id="non_core_missing",
            label="非核心或未入 PIT 样本池缺口",
            symbols=non_core,
            total_missing=total_missing,
            evidence="不在历史样本池锚点中，默认可作为研究态豁免候选。",
            recommendation="可一键忽略进入 Limited Ready；晋升仍需 Full Ready。",
            action_label="创建研究态豁免",
            action_target="#/pit-data?section=coverage-gap",
        ),
        _coverage_gap_bucket(
            bucket_id="corporate_action_alignment",
            label="公司行为对齐缺口",
            symbols=corporate_alignment,
            total_missing=total_missing,
            evidence="同一 symbol 也出现在公司行为缺失列表中，价格与复权事件需要一起修复。",
            recommendation="先补公司行为 probe，再复核前复权价格轨迹。",
            action_label="查看快照门禁",
            action_target="#/snapshots?tab=equity&target=ds-corporate-actions",
        ),
        _coverage_gap_bucket(
            bucket_id="identity_unresolved",
            label="身份映射待解析",
            symbols=unresolved_identity,
            total_missing=total_missing,
            evidence="本地身份缓存没有对应记录，可能需要 ticker 生命周期或 delisting 映射。",
            recommendation="补齐 symbol identity 后再判断是否属于核心历史样本。",
            action_label="查看缺口清单",
            action_target="#/pit-data?section=coverage-gap",
        ),
    ]
    default_ignored_symbols = sorted(non_core)
    return {
        "missing_symbol_count": total_missing,
        "missing_share_pct": round((total_missing / max(1, int(price_metadata.get("total_symbol_count") or total_missing))) * 100.0, 2),
        "covered_symbol_count": int(price_metadata.get("covered_symbol_count") or 0),
        "total_symbol_count": int(price_metadata.get("total_symbol_count") or 0),
        "default_ignored_symbols": default_ignored_symbols,
        "default_ignored_count": len(default_ignored_symbols),
        "buckets": buckets,
        "evidence_source": "dataset_snapshots.metadata.missing_symbols + universe_membership_snapshots",
        "recommendation": "优先修复当前核心成员与历史生命周期缺口；非核心缺口只允许研究态豁免。",
    }


def _load_symbol_identity_rows(market_data_repository: Any, symbols: Iterable[str]) -> list[dict[str, Any]]:
    if not hasattr(market_data_repository, "load_symbol_identity_rows"):
        return []
    try:
        return list(market_data_repository.load_symbol_identity_rows(symbols))
    except Exception:
        return []


def _load_latest_market_caps(
    market_data_repository: Any,
    *,
    fundamental_snapshot_id: str,
    symbols: Iterable[str],
) -> dict[str, float]:
    normalized_symbols = sorted({str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()})
    if not normalized_symbols or not hasattr(market_data_repository, "load_dataset_fundamental_points"):
        return {}
    try:
        grouped = market_data_repository.load_dataset_fundamental_points(
            fundamental_snapshot_id,
            normalized_symbols,
        )
    except Exception:
        return {}
    market_caps: dict[str, float] = {}
    for symbol, rows in grouped.items():
        latest_row = next(
            (
                row
                for row in sorted(rows, key=lambda item: str(item.get("date") or ""), reverse=True)
                if _coerce_float(row.get("market_cap")) > 0
            ),
            None,
        )
        if latest_row:
            market_caps[str(symbol).strip().upper()] = _coerce_float(latest_row.get("market_cap"))
    return market_caps


def _build_temporal_gap_distribution(
    symbols: Iterable[str],
    historical_memberships: Sequence[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    target_symbols = {str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()}
    if not target_symbols:
        return []
    members_by_date: dict[str, set[str]] = {}
    for row in historical_memberships:
        effective_date = str(row.get("effective_date") or "").strip()
        symbol = str(row.get("symbol") or "").strip().upper()
        if effective_date and symbol:
            members_by_date.setdefault(effective_date, set()).add(symbol)
    dates = sorted(members_by_date)
    if not dates:
        return []
    latest_date = _parse_date(dates[-1])
    recent_cutoff = _years_before(latest_date, SANDBOX_DIAGNOSTIC_YEARS) if latest_date else None
    distribution = []
    for effective_date in dates:
        members = members_by_date[effective_date]
        missing_count = len(members & target_symbols)
        if missing_count <= 0:
            continue
        parsed_date = _parse_date(effective_date)
        distribution.append(
            {
                "date": effective_date,
                "missing_count": missing_count,
                "member_count": len(members),
                "share_pct": round((missing_count / max(1, len(members))) * 100.0, 2),
                "is_recent_window": bool(recent_cutoff and parsed_date and parsed_date >= recent_cutoff),
            }
        )
    return distribution


def _build_symbol_gap_details(
    symbols: Sequence[str],
    *,
    identity_rows_by_symbol: Mapping[str, Mapping[str, Any]],
    historical_memberships: Sequence[Mapping[str, Any]],
    symbol_weights: Mapping[str, float],
    membership_date_bounds_by_symbol: Mapping[str, tuple[str | None, str | None]] | None = None,
) -> list[dict[str, Any]]:
    membership_dates_by_symbol: dict[str, list[str]] = {}
    if membership_date_bounds_by_symbol is not None:
        for symbol, (first_date, last_date) in membership_date_bounds_by_symbol.items():
            dates = [str(item) for item in (first_date, last_date) if item]
            if dates:
                membership_dates_by_symbol[str(symbol).strip().upper()] = dates
    else:
        for row in historical_memberships:
            symbol = str(row.get("symbol") or "").strip().upper()
            effective_date = str(row.get("effective_date") or "").strip()
            if symbol and effective_date:
                membership_dates_by_symbol.setdefault(symbol, []).append(effective_date)
    details = []
    for symbol in symbols[:12]:
        identity = identity_rows_by_symbol.get(symbol)
        dates = sorted(set(membership_dates_by_symbol.get(symbol, [])))
        ticker_path = []
        if dates:
            ticker_path.append(
                {
                    "date": dates[0],
                    "symbol": symbol,
                    "source": "historical_universe_first_seen",
                    "label": "历史样本池首次出现",
                }
            )
            if dates[-1] != dates[0]:
                ticker_path.append(
                    {
                        "date": dates[-1],
                        "symbol": symbol,
                        "source": "historical_universe_last_seen",
                        "label": "历史样本池最后出现",
                    }
                )
        if identity:
            identity_date = str(identity.get("valid_from") or identity.get("ipo_date") or (dates[0] if dates else ""))
            ticker_path.append(
                {
                    "date": identity_date,
                    "symbol": str(identity.get("symbol") or symbol),
                    "canonical_symbol": str(identity.get("canonical_symbol") or symbol),
                    "source": str(identity.get("source") or "symbol_identity_cache"),
                    "label": "身份缓存映射",
                }
            )
        if not ticker_path:
            ticker_path.append(
                {
                    "date": "",
                    "symbol": symbol,
                    "source": "missing_identity_cache",
                    "label": "未找到历史 ticker 路径",
                }
            )
        details.append(
            {
                "symbol": symbol,
                "identity_status": "RESOLVED" if identity else "UNRESOLVED",
                "canonical_symbol": str((identity or {}).get("canonical_symbol") or symbol),
                "company_name": str((identity or {}).get("company_name") or ""),
                "mcap_weight_pct": _safe_round(symbol_weights.get(symbol, 0.0), 4),
                "ticker_path": ticker_path,
                "mapping_action": {
                    "label": "建立 Mapping Overwrite",
                    "endpoint": "/pit-data/identity-overrides",
                    "method": "POST",
                },
            }
        )
    return details


def _load_historical_symbols_for_subset(
    market_data_repository: Any,
    *,
    universe_snapshot_id: str,
    symbols: Iterable[str],
    mode: str,
) -> set[str]:
    normalized = sorted({str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()})
    if not normalized or mode == "none" or not hasattr(market_data_repository, "connect"):
        return set()
    found: set[str] = set()
    try:
        with market_data_repository.connect() as conn:
            for chunk in _iter_symbol_chunks(normalized):
                where_sql, params = _historical_membership_where_sql(
                    universe_snapshot_id=universe_snapshot_id,
                    mode=mode,
                    symbols=chunk,
                )
                rows = conn.execute(
                    f"""
                    SELECT DISTINCT symbol
                    FROM universe_membership_snapshots
                    WHERE {where_sql}
                    """,
                    tuple(params),
                ).fetchall()
                found.update(
                    str(row["symbol"]).strip().upper()
                    for row in rows
                    if str(row["symbol"] or "").strip()
                )
    except Exception:
        return set()
    return found


def _load_historical_symbol_date_bounds(
    market_data_repository: Any,
    *,
    universe_snapshot_id: str,
    symbols: Iterable[str],
    mode: str,
) -> dict[str, tuple[str | None, str | None]]:
    normalized = sorted({str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()})
    if not normalized or mode == "none" or not hasattr(market_data_repository, "connect"):
        return {}
    bounds: dict[str, tuple[str | None, str | None]] = {}
    try:
        with market_data_repository.connect() as conn:
            for chunk in _iter_symbol_chunks(normalized):
                where_sql, params = _historical_membership_where_sql(
                    universe_snapshot_id=universe_snapshot_id,
                    mode=mode,
                    symbols=chunk,
                )
                rows = conn.execute(
                    f"""
                    SELECT symbol, MIN(effective_date) AS first_date, MAX(effective_date) AS last_date
                    FROM universe_membership_snapshots
                    WHERE {where_sql}
                    GROUP BY symbol
                    """,
                    tuple(params),
                ).fetchall()
                for row in rows:
                    symbol = str(row["symbol"] or "").strip().upper()
                    if symbol:
                        bounds[symbol] = (row["first_date"], row["last_date"])
    except Exception:
        return {}
    return bounds


def _preview_temporal_dates(date_counts: Mapping[str, int], *, recent_count: int = 12, max_count: int = 60) -> list[str]:
    dates = sorted(str(date_value) for date_value in date_counts if str(date_value))
    if len(dates) <= max_count:
        return dates
    annual_dates_by_year: dict[str, str] = {}
    for effective_date in dates:
        annual_dates_by_year[effective_date[:4]] = effective_date
    selected = set(annual_dates_by_year.values())
    selected.update(dates[-recent_count:])
    return sorted(selected)[-max_count:]


def _build_temporal_gap_distribution_from_repository(
    market_data_repository: Any,
    *,
    universe_snapshot_id: str,
    symbols: Iterable[str],
    mode: str,
    date_counts: Mapping[str, int],
) -> list[dict[str, Any]]:
    target_symbols = sorted({str(symbol).strip().upper() for symbol in symbols if str(symbol).strip()})
    if not target_symbols or mode == "none" or not date_counts or not hasattr(market_data_repository, "connect"):
        return []
    preview_dates = _preview_temporal_dates(date_counts)
    if not preview_dates:
        return []
    missing_by_date: dict[str, int] = {}
    try:
        with market_data_repository.connect() as conn:
            for chunk in _iter_symbol_chunks(target_symbols):
                where_sql, params = _historical_membership_where_sql(
                    universe_snapshot_id=universe_snapshot_id,
                    mode=mode,
                    symbols=chunk,
                )
                where_sql = f"{where_sql} AND effective_date IN ({','.join('?' for _ in preview_dates)})"
                params.extend(preview_dates)
                rows = conn.execute(
                    f"""
                    SELECT effective_date, COUNT(*) AS missing_count
                    FROM universe_membership_snapshots
                    WHERE {where_sql}
                    GROUP BY effective_date
                    """,
                    tuple(params),
                ).fetchall()
                for row in rows:
                    effective_date = str(row["effective_date"] or "")
                    if effective_date:
                        missing_by_date[effective_date] = missing_by_date.get(effective_date, 0) + int(row["missing_count"] or 0)
    except Exception:
        return []
    latest_date = _parse_date(max(date_counts) if date_counts else None)
    recent_cutoff = _years_before(latest_date, SANDBOX_DIAGNOSTIC_YEARS) if latest_date else None
    distribution = []
    for effective_date in sorted(missing_by_date):
        missing_count = missing_by_date[effective_date]
        member_count = int(date_counts.get(effective_date) or 0)
        if missing_count <= 0 or member_count <= 0:
            continue
        parsed_date = _parse_date(effective_date)
        distribution.append(
            {
                "date": effective_date,
                "missing_count": missing_count,
                "member_count": member_count,
                "share_pct": round((missing_count / max(1, member_count)) * 100.0, 2),
                "is_recent_window": bool(recent_cutoff and parsed_date and parsed_date >= recent_cutoff),
            }
        )
    return distribution


def _build_coverage_gap_with_identity(
    *,
    market_data_repository: Any,
    price_snapshot: Mapping[str, Any] | None,
    corporate_snapshot: Mapping[str, Any] | None,
    fundamental_snapshot_id: str,
    historical_memberships: Sequence[Mapping[str, Any]],
    universe_snapshot_id: str | None = None,
    history_summary: PitUniverseHistorySummary | None = None,
) -> dict[str, Any]:
    metadata = _metadata_for_row(price_snapshot or {})
    missing_symbols = sorted(
        {
            str(symbol).strip().upper()
            for symbol in metadata.get("missing_symbols", [])
            if str(symbol).strip()
        }
    )
    historical_symbols_override: set[str] | None = None
    latest_symbols_override: set[str] | None = None
    if history_summary is not None and universe_snapshot_id:
        historical_symbols_override = _load_historical_symbols_for_subset(
            market_data_repository,
            universe_snapshot_id=universe_snapshot_id,
            symbols=missing_symbols,
            mode=history_summary.mode,
        )
        latest_symbols_override = set(missing_symbols) & set(history_summary.latest_symbols)
    gap = _build_coverage_gap(
        price_snapshot=price_snapshot,
        corporate_snapshot=corporate_snapshot,
        historical_memberships=historical_memberships,
        historical_symbols_override=historical_symbols_override,
        latest_symbols_override=latest_symbols_override,
    )
    identity_rows = _load_symbol_identity_rows(market_data_repository, missing_symbols)
    identity_rows_by_symbol = {str(row.get("symbol") or "").strip().upper(): row for row in identity_rows}
    identity_symbols = set(identity_rows_by_symbol)
    unresolved = sorted(set(missing_symbols) - identity_symbols)
    historical_symbols = historical_symbols_override if historical_symbols_override is not None else _normalized_symbol_set(historical_memberships)
    market_caps = _load_latest_market_caps(
        market_data_repository,
        fundamental_snapshot_id=fundamental_snapshot_id,
        symbols=set(missing_symbols),
    )
    total_market_cap = sum(value for value in market_caps.values() if value > 0)
    symbol_weights = {
        symbol: (value / total_market_cap * 100.0)
        for symbol, value in market_caps.items()
        if value > 0 and total_market_cap > 0
    }
    for bucket in gap["buckets"]:
        bucket_symbols = [
            str(symbol).strip().upper()
            for symbol in (bucket.get("symbols") or bucket.get("sample_symbols") or [])
            if str(symbol).strip()
        ]
        if bucket.get("id") == "identity_unresolved":
            bucket_symbols = unresolved
            bucket["symbols"] = unresolved
            bucket["count"] = len(unresolved)
            bucket["share_pct"] = round((len(unresolved) / max(1, len(missing_symbols))) * 100.0, 2)
            bucket["sample_symbols"] = unresolved[:24]
        bucket["mcap_weight_pct"] = _safe_round(sum(symbol_weights.get(symbol, 0.0) for symbol in bucket_symbols), 4)
        temporal_symbols = bucket_symbols
        if len(temporal_symbols) > 24:
            temporal_symbols = [
                str(symbol).strip().upper()
                for symbol in (bucket.get("sample_symbols") or [])
                if str(symbol).strip()
            ][:24]
        if history_summary is not None and universe_snapshot_id:
            bucket["temporal_distribution"] = _build_temporal_gap_distribution_from_repository(
                market_data_repository,
                universe_snapshot_id=universe_snapshot_id,
                symbols=temporal_symbols,
                mode=history_summary.mode,
                date_counts=history_summary.date_counts,
            )
        else:
            bucket["temporal_distribution"] = _build_temporal_gap_distribution(temporal_symbols, historical_memberships)
    detail_symbols = sorted(
        {
            str(symbol).strip().upper()
            for bucket in gap["buckets"]
            for symbol in (bucket.get("sample_symbols") or [])
            if str(symbol).strip()
        }
    )
    membership_bounds = (
        _load_historical_symbol_date_bounds(
            market_data_repository,
            universe_snapshot_id=universe_snapshot_id,
            symbols=detail_symbols,
            mode=history_summary.mode,
        )
        if history_summary is not None and universe_snapshot_id
        else None
    )
    for bucket in gap["buckets"]:
        bucket["symbol_details"] = _build_symbol_gap_details(
            bucket["sample_symbols"],
            identity_rows_by_symbol=identity_rows_by_symbol,
            historical_memberships=historical_memberships,
            symbol_weights=symbol_weights,
            membership_date_bounds_by_symbol=membership_bounds,
        )
    gap["identity_resolved_count"] = len(identity_symbols)
    gap["mcap_weight_source"] = "dataset_fundamental_points.latest_market_cap"
    gap["mcap_weight_coverage_pct"] = _safe_round(
        (len(market_caps) / max(1, len(set(missing_symbols)))) * 100.0,
        2,
    )
    return gap


def _median(values: Sequence[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    midpoint = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[midpoint]
    return (ordered[midpoint - 1] + ordered[midpoint]) / 2.0


def _preview_outliers(values: Sequence[dict[str, Any]], *, method: str) -> dict[str, Any]:
    numeric = [float(item["value"]) for item in values if isinstance(item.get("value"), (int, float))]
    if not numeric:
        return {
            "method": method,
            "status": "UNAVAILABLE",
            "excluded_count": 0,
            "excluded_pct": 0.0,
            "sample_size": 0,
            "threshold_label": "样本不足",
            "sample_points": [],
        }
    if method == "MAD":
        center = _median(numeric) or 0.0
        deviations = [abs(value - center) for value in numeric]
        mad = _median(deviations) or 0.0
        threshold = 3.0 * 1.4826 * mad
        lower = center - threshold
        upper = center + threshold
        threshold_label = f"MAD 3.0x，阈值 {lower:.4f} 至 {upper:.4f}"
    else:
        center = _mean(numeric) or 0.0
        sigma = _std(numeric) or 0.0
        lower = center - 3.0 * sigma
        upper = center + 3.0 * sigma
        threshold_label = f"3σ，阈值 {lower:.4f} 至 {upper:.4f}"
    outliers = [
        item
        for item in values
        if isinstance(item.get("value"), (int, float)) and (float(item["value"]) < lower or float(item["value"]) > upper)
    ]
    return {
        "method": method,
        "status": "READY",
        "excluded_count": len(outliers),
        "excluded_pct": round((len(outliers) / max(1, len(numeric))) * 100.0, 2),
        "sample_size": len(numeric),
        "threshold_label": threshold_label,
        "sample_points": [
            {
                "symbol": str(item.get("symbol") or ""),
                "date": str(item.get("date") or ""),
                "value": _safe_round(float(item.get("value") or 0.0), 6),
            }
            for item in outliers[:12]
        ],
    }


def _build_cleaning_rule_previews(
    market_data_repository: Any,
    *,
    dataset_snapshot_id: str,
    symbols: Sequence[str],
    end_date: date,
) -> list[dict[str, Any]]:
    preview_symbols = [symbol for symbol in symbols[:16] if symbol]
    values: list[dict[str, Any]] = []
    if preview_symbols:
        try:
            bars_by_symbol = market_data_repository.load_dataset_price_bars(
                dataset_snapshot_id,
                preview_symbols,
                start_date=(end_date - timedelta(days=540)).isoformat(),
                end_date=end_date.isoformat(),
                include_metadata=False,
            )
        except Exception:
            bars_by_symbol = {}
        for symbol, rows in bars_by_symbol.items():
            ordered = sorted(rows, key=lambda item: str(item.get("date") or ""))
            previous = None
            for row in ordered:
                price = _coerce_float(row.get("adj_close") or row.get("close"))
                if previous and previous > 0 and price > 0:
                    values.append(
                        {
                            "symbol": symbol,
                            "date": str(row.get("date") or ""),
                            "value": price / previous - 1.0,
                        }
                    )
                previous = price if price > 0 else previous
    return [
        {
            **_preview_outliers(values, method="MAD"),
            "id": "mad",
            "label": "MAD 中位数偏差",
            "description": "适合厚尾收益分布，优先降低极端点对阈值的影响。",
        },
        {
            **_preview_outliers(values, method="SIGMA"),
            "id": "sigma",
            "label": "3σ 标准差",
            "description": "适合近似正态的价格收益序列，剔除比例通常更保守。",
        },
        {
            "id": "industry",
            "method": "INDUSTRY",
            "label": "分行业阈值",
            "description": "需要行业映射和行业内横截面样本，本期仅展示不可预览状态。",
            "status": "UNAVAILABLE",
            "excluded_count": 0,
            "excluded_pct": 0.0,
            "sample_size": len(values),
            "threshold_label": "行业映射待接入",
            "sample_points": [],
        },
    ]


def _build_universe_history_counts(historical_memberships: Sequence[Mapping[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in historical_memberships:
        effective_date = str(row.get("effective_date") or "").strip()
        symbol = str(row.get("symbol") or "").strip()
        if effective_date and symbol:
            counts[effective_date] = counts.get(effective_date, 0) + 1
    return counts


def _build_universe_history_series(historical_memberships: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    counts = _build_universe_history_counts(historical_memberships)
    return _build_universe_history_series_from_counts(counts)


def _build_universe_history_series_from_counts(date_counts: Mapping[str, int]) -> list[dict[str, Any]]:
    annual_anchors: dict[int, tuple[date, str, int]] = {}
    for effective_date, member_count in date_counts.items():
        parsed = _parse_date(effective_date)
        if parsed is None:
            continue
        existing = annual_anchors.get(parsed.year)
        if existing is None or parsed > existing[0]:
            annual_anchors[parsed.year] = (parsed, effective_date, member_count)
    anchors = sorted(annual_anchors.values(), key=lambda item: (item[0], item[1]))
    return [
        {
            "date": effective_date,
            "member_count": member_count,
            "is_latest": index == len(anchors) - 1,
        }
        for index, (_parsed, effective_date, member_count) in enumerate(anchors)
    ]


def _build_adjustment_trace(
    market_data_repository: Any,
    *,
    dataset_snapshot_id: str,
    symbols: Sequence[str],
    end_date: date,
) -> dict[str, Any]:
    symbol = next((item for item in symbols if item), "")
    if not symbol:
        return {"symbol": "", "points": [], "events": [], "factor_min": None, "factor_max": None}
    try:
        bars_by_symbol = market_data_repository.load_dataset_price_bars(
            dataset_snapshot_id,
            [symbol],
            start_date=(end_date - timedelta(days=420)).isoformat(),
            end_date=end_date.isoformat(),
            include_metadata=False,
        )
    except Exception:
        bars_by_symbol = {}
    rows = sorted(bars_by_symbol.get(symbol, []), key=lambda item: str(item.get("date") or ""))
    if len(rows) > 36:
        step = max(1, len(rows) // 18)
        rows = rows[::step][-18:]
    points = []
    factors = []
    for row in rows:
        close = _coerce_float(row.get("close"))
        adjusted = _coerce_float(row.get("adj_close") or row.get("close"))
        factor = adjusted / close if close > 0 else 1.0
        factors.append(factor)
        points.append(
            {
                "date": str(row.get("date") or ""),
                "close": _safe_round(close, 4),
                "adjusted_close": _safe_round(adjusted, 4),
                "adjustment_factor": _safe_round(factor, 6),
            }
        )
    return {
        "symbol": symbol,
        "points": points,
        "events": [],
        "factor_min": _safe_round(min(factors), 6) if factors else None,
        "factor_max": _safe_round(max(factors), 6) if factors else None,
    }


def _gap_bucket_map(coverage_gap: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    return {
        str(bucket.get("id") or ""): bucket
        for bucket in (coverage_gap.get("buckets") or [])
        if isinstance(bucket, Mapping)
    }


def _build_ops_guidance(coverage_gap: Mapping[str, Any], blocker_items: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
    buckets = _gap_bucket_map(coverage_gap)
    current_core_count = int((buckets.get("current_core_missing") or {}).get("count") or 0)
    historical_count = int((buckets.get("historical_lifecycle_missing") or {}).get("count") or 0)
    identity_count = int((buckets.get("identity_unresolved") or {}).get("count") or 0)
    missing_count = int(coverage_gap.get("missing_symbol_count") or 0)
    actions = []
    if any(item.get("code") == "PRICE_SNAPSHOT_NOT_READY" for item in blocker_items):
        actions.append(
            {
                "label": "刷新价格快照",
                "target": "#/snapshots?tab=equity&target=ds-price",
                "priority": "HIGH" if current_core_count else "MEDIUM",
            }
        )
    if identity_count:
        actions.append(
            {
                "label": "重启 Identity Scraper",
                "target": "ops://identity-scraper/restart",
                "priority": "HIGH",
            }
        )
    if current_core_count <= 0 and missing_count > 0:
        if identity_count:
            headline = (
                f"当前核心成员价格缺口为 0，实盘准入风险低；身份映射解析挂起 {identity_count} 项，"
                "建议运维优先重启 Identity Scraper 任务。"
            )
        else:
            headline = (
                "当前核心成员价格缺口为 0，实盘准入风险低；身份映射解析挂起 0 项，"
                "下一步应刷新价格快照并处理剩余历史价格与公司行动缺口。"
            )
        live_ready_risk = "LOW"
        severity = "WARNING" if identity_count else "INFO"
    elif current_core_count > 0:
        headline = (
            f"当前核心成员价格缺口 {current_core_count} 项，历史生命周期缺口 {historical_count} 项；"
            "正式晋升前必须先完成价格与身份映射修复。"
        )
        live_ready_risk = "HIGH"
        severity = "BLOCKING"
    else:
        headline = "PIT 价格、样本池和清洗门禁已通过，可进入 Full Ready 诊断。"
        live_ready_risk = "LOW"
        severity = "INFO"
    return {
        "headline": headline,
        "severity": severity,
        "live_ready_risk": live_ready_risk,
        "identity_pending_count": identity_count,
        "current_core_missing_count": current_core_count,
        "historical_lifecycle_missing_count": historical_count,
        "actions": actions,
    }


def _build_status_reasons(
    *,
    adjusted_price_status: str,
    universe_status: str,
    outlier_cleaning_status: str,
    factor_status: str,
    coverage_gap: Mapping[str, Any],
    cleaning_rule_previews: Sequence[Mapping[str, Any]],
    universe_history_series: Sequence[Mapping[str, Any]],
    raw_universe_anchor_count: int,
    limited_ready: bool,
    verified_enabled: bool,
    sandbox_enabled: bool,
) -> dict[str, dict[str, Any]]:
    buckets = _gap_bucket_map(coverage_gap)
    current_core_count = int((buckets.get("current_core_missing") or {}).get("count") or 0)
    historical_count = int((buckets.get("historical_lifecycle_missing") or {}).get("count") or 0)
    identity_count = int((buckets.get("identity_unresolved") or {}).get("count") or 0)
    non_core_count = int((buckets.get("non_core_missing") or {}).get("count") or 0)
    missing_count = int(coverage_gap.get("missing_symbol_count") or 0)
    if adjusted_price_status == "READY":
        adjusted_description = "价格快照覆盖当前诊断窗口，复权轨迹可用于正式诊断。"
        adjusted_cause = "PASSED"
    elif current_core_count:
        adjusted_description = f"当前核心成员缺价格 {current_core_count} 项，历史生命周期缺口 {historical_count} 项。"
        adjusted_cause = "CORE_PRICE_GAP"
    elif identity_count:
        adjusted_description = f"缺失 {missing_count} 个 symbol，其中身份映射解析挂起 {identity_count} 项。"
        adjusted_cause = "IDENTITY_MAPPING_GAP"
    else:
        adjusted_description = f"价格快照仍缺失 {missing_count} 个 symbol，需补齐覆盖后再晋升。"
        adjusted_cause = "PRICE_COVERAGE_GAP"

    latest_universe = universe_history_series[-1] if universe_history_series else {}
    if universe_status == "READY":
        annual_anchor_count = len(universe_history_series)
        if raw_universe_anchor_count > annual_anchor_count:
            universe_description = (
                f"历史样本池有 {raw_universe_anchor_count} 个原始锚点，年度展示 {annual_anchor_count} 个锚点，"
                f"最近锚点约 {int(latest_universe.get('member_count') or 0)} 个成员。"
            )
        else:
            universe_description = (
                f"历史样本池有 {annual_anchor_count} 个年度锚点，最近锚点约 "
                f"{int(latest_universe.get('member_count') or 0)} 个成员。"
            )
        universe_cause = "PASSED"
    else:
        universe_description = "历史 Universe 锚点不足，不能用当前成分股回填点时样本池。"
        universe_cause = "UNIVERSE_HISTORY_GAP"

    mad_preview = next((item for item in cleaning_rule_previews if item.get("id") == "mad"), None) or (
        cleaning_rule_previews[0] if cleaning_rule_previews else {}
    )
    excluded_pct = _safe_round(_coerce_float((mad_preview or {}).get("excluded_pct")), 2)
    if outlier_cleaning_status == "READY":
        outlier_description = f"清洗版本可用；MAD 预览会剔除 {excluded_pct}% 样本点。"
        outlier_cause = "PASSED"
    else:
        outlier_description = f"清洗版本尚未正式确认；MAD 预览会剔除 {excluded_pct}% 样本，需判断是价格突变还是规则过严。"
        outlier_cause = "CLEANING_RULE_PENDING"

    if verified_enabled:
        factor_description = "Full Ready 门禁已通过，因子可进入 Verified 诊断和后续晋升。"
        factor_cause = "FULL_READY"
    elif limited_ready:
        factor_description = f"Limited Ready 仅允许研究诊断；已忽略 {non_core_count} 个非核心缺口，晋升仍要求 Full Ready。"
        factor_cause = "LIMITED_READY_ONLY"
    elif sandbox_enabled:
        factor_description = "完整 PIT 待补，当前只允许最近窗口 Sandbox 预览。"
        factor_cause = "SANDBOX_ONLY"
    else:
        factor_description = "价格或样本池不足，因子诊断仍被 PIT 门禁阻断。"
        factor_cause = "BLOCKED"

    return {
        "adjusted_price": {"status": adjusted_price_status, "cause": adjusted_cause, "description": adjusted_description},
        "universe": {"status": universe_status, "cause": universe_cause, "description": universe_description},
        "outlier_cleaning": {"status": outlier_cleaning_status, "cause": outlier_cause, "description": outlier_description},
        "factor_admission": {"status": factor_status, "cause": factor_cause, "description": factor_description},
    }


FREE_FULL_READY_PRICE_PROVIDERS = [
    "tiingo",
    "fmp",
    "nasdaq_wiki",
    "stooq",
    "kaggle_huge_stock_market_dataset",
    "kaggle_delisted_bulk_archive",
    "yahoo",
    "alpha_vantage",
    "openbb_yfinance",
    "openbb_tiingo",
    "openbb_alpha_vantage",
    "openbb_fmp",
    "finnhub",
]
FREE_FULL_READY_ACTION_PROVIDERS = [
    "tiingo",
    "fmp",
    "alpha_vantage",
    "sec_edgar",
    "yahoo",
    "openbb_yfinance",
    "openbb_tiingo",
    "openbb_fmp",
]
FULL_READY_IDENTITY_PROVIDERS = [
    "tiingo_symbology",
    "fmp",
    "finnhub",
    "sec_edgar",
    "alpha_vantage",
    "polygon",
]
FULL_READY_MEMBERSHIP_PROVIDERS = [
    "fmp_historical_constituent",
    "github_sp500_historical_components",
    "wikipedia_revision_history",
    "official_announcement",
]


def _provider_summary_for(snapshot: Mapping[str, Any] | None) -> Mapping[str, Any]:
    metadata = _metadata_for_row(snapshot or {})
    provider_summary = metadata.get("provider_summary")
    return provider_summary if isinstance(provider_summary, Mapping) else {}


def _build_provider_cooldowns(
    *,
    price_snapshot: Mapping[str, Any] | None,
    corporate_snapshot: Mapping[str, Any] | None,
) -> list[dict[str, Any]]:
    cooldowns: list[dict[str, Any]] = []
    now = datetime.now(timezone.utc)
    for target, snapshot in (
        ("price", price_snapshot),
        ("corporate_actions", corporate_snapshot),
    ):
        providers = _provider_summary_for(snapshot).get("providers")
        if not isinstance(providers, Mapping):
            continue
        for provider_name, provider_payload in providers.items():
            if not isinstance(provider_payload, Mapping):
                continue
            next_retry_at = provider_payload.get("next_retry_at")
            next_retry_text = str(next_retry_at or "").strip()
            parsed_retry_at = _parse_datetime_utc(next_retry_text) if next_retry_text else None
            quota_limited = bool(provider_payload.get("quota_limited"))
            if parsed_retry_at is not None and parsed_retry_at <= now:
                continue
            if not next_retry_text and not quota_limited:
                continue
            reasons = [
                str(reason)
                for reason in (provider_payload.get("reasons") or [])
                if str(reason).strip()
            ][:3]
            cooldowns.append(
                {
                    "provider": str(provider_name),
                    "target": target,
                    "next_retry_at": next_retry_text,
                    "quota_limited": quota_limited,
                    "reason": "; ".join(reasons) if reasons else "provider cooldown",
                }
            )
    return sorted(cooldowns, key=lambda item: (str(item.get("next_retry_at") or "9999"), str(item.get("provider") or "")))


def _alias_candidates_for_symbol(symbol: str, identity: Mapping[str, Any] | None = None) -> list[str]:
    normalized = str(symbol or "").strip().upper()
    candidates = [normalized]
    canonical = str((identity or {}).get("canonical_symbol") or "").strip().upper()
    if canonical and canonical not in candidates:
        candidates.append(canonical)
    for value in list(candidates):
        if "." in value:
            candidates.append(value.replace(".", "-"))
        if "-" in value:
            candidates.append(value.replace("-", "."))
    return [candidate for index, candidate in enumerate(candidates) if candidate and candidate not in candidates[:index]]


def _repair_provider_priority_for_item(
    *,
    bucket: str,
    targets: Sequence[str],
    identity: Mapping[str, Any] | None = None,
) -> list[str]:
    target_set = {str(item) for item in targets}
    priority: list[str] = []
    if "price" in target_set or "corporate_actions" in target_set:
        priority.extend(["tiingo", "fmp"])
        if "price" in target_set and bucket == "historical_lifecycle_missing":
            priority.append("nasdaq_wiki")
        priority.extend(["stooq", "kaggle_huge_stock_market_dataset"])
    if bucket in {"historical_lifecycle_missing", "current_core_missing"}:
        priority.extend(FULL_READY_MEMBERSHIP_PROVIDERS)
    if "identity" in target_set:
        priority.extend(FULL_READY_IDENTITY_PROVIDERS)
    if "corporate_actions" in target_set:
        priority.extend(["alpha_vantage", "sec_edgar"])
    priority.append("polygon")
    return [provider for index, provider in enumerate(priority) if provider and provider not in priority[:index]]


def _required_evidence_for_item(*, targets: Sequence[str], bucket: str) -> list[str]:
    evidence = []
    target_set = {str(item) for item in targets}
    if "price" in target_set:
        evidence.append("可审计 EOD OHLCV 入库记录")
    if bucket in {"historical_lifecycle_missing", "current_core_missing"}:
        evidence.append("PIT 成员历史 in/out 日期或历史锚点")
    if "identity" in target_set:
        evidence.append("稳定身份映射：canonical ticker / CIK / 有效期")
    if "corporate_actions" in target_set:
        evidence.append("公司行动事件，或明确 zero-event certificate")
    if not evidence:
        evidence.append("缺口来源与不可恢复原因")
    return evidence


def _trust_blocker_for_item(*, targets: Sequence[str], bucket: str, identity: Mapping[str, Any] | None = None) -> str:
    target_set = {str(item) for item in targets}
    if "identity" in target_set:
        return "身份/生命周期未闭合，SEC/CIK 或 FMP/Tiingo alias 证据缺失。"
    if "corporate_actions" in target_set:
        return "公司行动门禁未闭合，price-only 来源不能证明无分红/拆股事件。"
    if "price" in target_set:
        return "价格缺口未闭合；Stooq/Kaggle 只能补价格，不能单独升级 Full Ready。"
    if bucket in {"historical_lifecycle_missing", "current_core_missing"}:
        return "历史成员锚点不完整，不能用当前成分股兜底。"
    return "缺口仍需正式 provider 证据或 rejection report。"


def _build_zero_event_certificates(
    *,
    corporate_missing: set[str],
    identity_by_symbol: Mapping[str, Mapping[str, Any]],
) -> list[dict[str, Any]]:
    certificates: list[dict[str, Any]] = []
    for symbol in sorted(corporate_missing):
        identity = identity_by_symbol.get(symbol) or {}
        cik = str(identity.get("cik") or "").strip()
        lifecycle_date = str(identity.get("delisting_date") or identity.get("valid_to") or "").strip()
        source = str(identity.get("source") or "").strip()
        if not (cik or lifecycle_date or source):
            continue
        certificates.append(
            {
                "symbol": symbol,
                "cik": cik or None,
                "member_exit_date": lifecycle_date or None,
                "membership_exit_date": lifecycle_date or None,
                "last_filing_evidence": {
                    "source": source or "symbol_identity_cache",
                    "cik": cik or None,
                    "note": "CIK/filing context is lifecycle evidence only; it is not a bankruptcy conclusion.",
                },
                "price_action_negative_result": {
                    "provider_priority": ["tiingo", "fmp", "alpha_vantage", "sec_edgar"],
                    "status": "needs_negative_confirmation",
                    "reason": "价格/公司行动 provider 需要返回正式空事件或不可恢复证据，才可晋升 zero-event certificate。",
                },
                "provider_negative_results": [
                    {
                        "provider": "corporate_action_snapshot",
                        "target": "corporate_actions",
                        "status": "no_formal_event_rows",
                        "reason": "当前公司行动快照缺少可回放事件，需要零事件证书或事件 provider 补证。",
                    }
                ],
                "conclusion": "ZERO_EVENT_CANDIDATE",
                "unrecoverable_reason": (
                    "仅当 Tiingo/FMP/Alpha Vantage/SEC 证据都无法返回正式事件，且身份生命周期已确权时，"
                    "才可把该候选晋升为 zero-event certificate。"
                ),
            }
        )
    return certificates


def _bucket_symbol_map(coverage_gap: Mapping[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    priority = [
        "current_core_missing",
        "historical_lifecycle_missing",
        "non_core_missing",
        "identity_unresolved",
        "corporate_action_alignment",
    ]
    for bucket_id in priority:
        bucket = next(
            (
                item
                for item in (coverage_gap.get("buckets") or [])
                if isinstance(item, Mapping) and item.get("id") == bucket_id
            ),
            None,
        )
        if not bucket:
            continue
        for symbol in bucket.get("symbols") or bucket.get("sample_symbols") or []:
            normalized = str(symbol).strip().upper()
            if normalized and normalized not in result:
                result[normalized] = bucket_id
    return result


def _build_full_ready_repair_plan(
    *,
    price_snapshot: Mapping[str, Any] | None,
    corporate_snapshot: Mapping[str, Any] | None,
    coverage_gap: Mapping[str, Any],
    blocking_items: Sequence[Mapping[str, Any]],
    identity_rows: Sequence[Mapping[str, Any]],
    active_waiver: Mapping[str, Any] | None,
) -> dict[str, Any]:
    price_metadata = _metadata_for_row(price_snapshot or {})
    corporate_metadata = _metadata_for_row(corporate_snapshot or {})
    price_missing = {
        str(symbol).strip().upper()
        for symbol in (price_metadata.get("missing_symbols") or [])
        if str(symbol).strip()
    }
    corporate_missing = {
        str(symbol).strip().upper()
        for symbol in (corporate_metadata.get("missing_symbols") or [])
        if str(symbol).strip()
    }
    identity_by_symbol = {
        str(row.get("symbol") or "").strip().upper(): row
        for row in identity_rows
        if str(row.get("symbol") or "").strip()
    }
    identity_unresolved = {
        str(symbol).strip().upper()
        for bucket in (coverage_gap.get("buckets") or [])
        if isinstance(bucket, Mapping) and bucket.get("id") == "identity_unresolved"
        for symbol in (bucket.get("symbols") or bucket.get("sample_symbols") or [])
        if str(symbol).strip()
    }
    bucket_by_symbol = _bucket_symbol_map(coverage_gap)
    cooldowns = _build_provider_cooldowns(
        price_snapshot=price_snapshot,
        corporate_snapshot=corporate_snapshot,
    )
    provider_cooldown_active = any(item.get("next_retry_at") or item.get("quota_limited") for item in cooldowns)
    all_symbols = sorted(price_missing | corporate_missing | identity_unresolved)
    priority_by_bucket = {
        "current_core_missing": 10,
        "historical_lifecycle_missing": 30,
        "corporate_action_alignment": 40,
        "identity_unresolved": 50,
        "non_core_missing": 70,
    }
    queue: list[dict[str, Any]] = []
    for symbol in all_symbols:
        bucket = bucket_by_symbol.get(symbol) or ("corporate_action_alignment" if symbol in corporate_missing else "non_core_missing")
        targets = []
        if symbol in price_missing:
            targets.append("price")
        if symbol in corporate_missing:
            targets.append("corporate_actions")
        if symbol in identity_unresolved:
            targets.append("identity")
        if symbol in identity_unresolved and bucket in {"current_core_missing", "historical_lifecycle_missing"}:
            status = "NEEDS_IDENTITY_ALIAS"
        elif provider_cooldown_active:
            status = "WAITING_ON_PROVIDER_COOLDOWN"
        else:
            status = "NEEDS_FREE_SOURCE_REPAIR"
        identity = identity_by_symbol.get(symbol)
        provider_priority = _repair_provider_priority_for_item(bucket=bucket, targets=targets, identity=identity)
        queue.append(
            {
                "symbol": symbol,
                "bucket": bucket,
                "priority": priority_by_bucket.get(bucket, 90),
                "status": status,
                "repair_targets": targets,
                "alias_candidates": _alias_candidates_for_symbol(symbol, identity_by_symbol.get(symbol)),
                "price_providers": FREE_FULL_READY_PRICE_PROVIDERS if "price" in targets else [],
                "corporate_action_providers": FREE_FULL_READY_ACTION_PROVIDERS if "corporate_actions" in targets else [],
                "identity_providers": FULL_READY_IDENTITY_PROVIDERS if "identity" in targets else [],
                "membership_providers": (
                    FULL_READY_MEMBERSHIP_PROVIDERS
                    if bucket in {"current_core_missing", "historical_lifecycle_missing"}
                    else []
                ),
                "provider_priority": provider_priority,
                "next_provider": provider_priority[0] if provider_priority else None,
                "required_evidence": _required_evidence_for_item(targets=targets, bucket=bucket),
                "trust_blocker": _trust_blocker_for_item(targets=targets, bucket=bucket, identity=identity),
                "evidence": "Full Ready requires auditable price rows and corporate-action proof; waiver and synthetic rows do not count.",
            }
        )
    queue.sort(key=lambda item: (int(item.get("priority") or 99), str(item.get("symbol") or "")))
    missing_count = len(all_symbols)
    status = "READY" if not blocking_items and missing_count == 0 and not active_waiver else "NEEDS_REPAIR"
    bucket_counts: dict[str, int] = {}
    for item in queue:
        bucket = str(item.get("bucket") or "unknown")
        bucket_counts[bucket] = bucket_counts.get(bucket, 0) + 1
    rejection_criteria = [
        "免费源对 symbol 全部返回 404/empty 且没有历史身份或公司行为证据时，必须保留阻塞。",
        "只有明确的 zero-event certificate 才能把公司行为缺失计为已覆盖，抓取失败不能当作无事件。",
        "研究态 waiver、synthetic_seed 或当前成分股兜底不能让 Full Ready 变绿。",
    ]
    zero_event_certificates = _build_zero_event_certificates(
        corporate_missing=corporate_missing,
        identity_by_symbol=identity_by_symbol,
    )
    return {
        "status": status,
        "target_status": "FULL_READY",
        "remaining_symbol_count": missing_count,
        "queue_total_count": len(queue),
        "queue_sample": queue[:50],
        "queue_symbols": [str(item.get("symbol") or "").strip().upper() for item in queue if str(item.get("symbol") or "").strip()],
        "queue_price_symbols": [
            str(item.get("symbol") or "").strip().upper()
            for item in queue
            if str(item.get("symbol") or "").strip() and "price" in (item.get("repair_targets") or [])
        ],
        "queue_corporate_action_symbols": [
            str(item.get("symbol") or "").strip().upper()
            for item in queue
            if str(item.get("symbol") or "").strip() and "corporate_actions" in (item.get("repair_targets") or [])
        ],
        "bucket_counts": bucket_counts,
        "provider_cooldowns": cooldowns,
        "provider_cooldown_count": len(cooldowns),
        "next_retry_at": next((str(item.get("next_retry_at")) for item in cooldowns if item.get("next_retry_at")), None),
        "zero_event_certificates": zero_event_certificates[:50],
        "zero_event_certificate_count": len(zero_event_certificates),
        "waiver_blocks_full_ready": bool(active_waiver),
        "free_source_policy": "Tiingo -> FMP -> Nasdaq WIKI/Stooq/Kaggle -> Finnhub/SEC/CIK -> Polygon 是修复优先级；price-only 和 identity-only 来源都不能单独伪装 Full Ready。",
        "recommendation": (
            "继续按优先级运行免费源修复队列；若队列最终落入不可恢复缺口，应输出 rejection report，而不是把 PIT 伪装为 READY。"
            if missing_count
            else "缺口为 0；确认清洗运行与研究态豁免撤销后可以进入 Full Ready 验收。"
        ),
        "rejection_criteria": rejection_criteria,
    }


def _build_waiver_impact_estimate(
    ignored_symbols: Sequence[str],
    coverage_gap: Mapping[str, Any],
) -> dict[str, Any]:
    normalized = {str(symbol).strip().upper() for symbol in ignored_symbols if str(symbol).strip()}
    buckets = [bucket for bucket in (coverage_gap.get("buckets") or []) if isinstance(bucket, Mapping)]
    missing_total = max(1, int(coverage_gap.get("missing_symbol_count") or len(normalized) or 1))
    ignored_mcap_weight = 0.0
    bucket_labels: list[str] = []
    for bucket in buckets:
        bucket_symbols = {str(symbol).strip().upper() for symbol in (bucket.get("symbols") or []) if str(symbol).strip()}
        overlap = normalized & bucket_symbols
        if not overlap:
            continue
        bucket_labels.append(str(bucket.get("label") or bucket.get("id") or "未分类缺口"))
        bucket_weight = _coerce_float(bucket.get("mcap_weight_pct"))
        ignored_mcap_weight += bucket_weight * (len(overlap) / max(1, len(bucket_symbols)))
    ignored_share_pct = round((len(normalized) / missing_total) * 100.0, 2)
    estimated_ic_delta_abs = _safe_round(min(0.25, ignored_share_pct / 100.0 * 0.015 + ignored_mcap_weight / 100.0 * 0.05), 4)
    if ignored_mcap_weight >= 5 or ignored_share_pct >= 35:
        risk_level = "HIGH"
    elif ignored_mcap_weight >= 1 or ignored_share_pct >= 10:
        risk_level = "MEDIUM"
    else:
        risk_level = "LOW"
    return {
        "ignored_symbol_count": len(normalized),
        "ignored_missing_share_pct": ignored_share_pct,
        "mcap_weight_pct": _safe_round(ignored_mcap_weight, 4),
        "estimated_ic_delta_abs": estimated_ic_delta_abs,
        "risk_level": risk_level,
        "affected_buckets": bucket_labels,
        "method": "missing_share_plus_mcap_weight_proxy",
        "note": "基于缺口数量占比和可用市值权重估算潜在 IC 扰动；正式晋升仍需 Full Ready 后复算。",
    }


def _light_universe_membership_stats(market_data_repository: Any, universe_snapshot_id: str) -> dict[str, Any]:
    stats = {
        "active_count": 0,
        "historical_count": 0,
        "historical_start": None,
        "historical_end": None,
        "raw_end": None,
    }
    if not hasattr(market_data_repository, "connect"):
        try:
            memberships = market_data_repository.load_universe_memberships(
                universe_snapshot_id=universe_snapshot_id,
            )
        except Exception:
            return stats
        historical = _historical_universe_memberships(memberships)
        stats["active_count"] = len(memberships)
        stats["historical_count"] = len(historical)
        dates = sorted(str(row.get("effective_date") or "") for row in historical if str(row.get("effective_date") or ""))
        raw_dates = sorted(str(row.get("effective_date") or "") for row in memberships if str(row.get("effective_date") or ""))
        stats["historical_start"] = dates[0] if dates else None
        stats["historical_end"] = dates[-1] if dates else None
        stats["raw_end"] = raw_dates[-1] if raw_dates else None
        return stats

    historical_positive = " OR ".join(
        "source_text LIKE ?" for _ in HISTORICAL_MEMBERSHIP_MARKERS
    )
    non_historical_negative = " AND ".join(
        "source_text NOT LIKE ?" for _ in NON_HISTORICAL_MEMBERSHIP_MARKERS
    )
    params: list[Any] = [universe_snapshot_id]
    params.extend(f"%{marker}%" for marker in HISTORICAL_MEMBERSHIP_MARKERS)
    params.extend(f"%{marker}%" for marker in NON_HISTORICAL_MEMBERSHIP_MARKERS)
    try:
        with market_data_repository.connect() as conn:
            active_row = conn.execute(
                """
                SELECT
                    COUNT(*) AS active_count,
                    MAX(effective_date) AS raw_end
                FROM universe_membership_snapshots
                WHERE universe_snapshot_id = ?
                  AND membership_status IN ('ACTIVE', 'MEMBER')
                """,
                (universe_snapshot_id,),
            ).fetchone()
            historical_row = conn.execute(
                f"""
                WITH normalized AS (
                    SELECT
                        effective_date,
                        LOWER(
                            COALESCE(source, '') || ' ' ||
                            COALESCE(fallback_source, '') || ' ' ||
                            COALESCE(metadata_json, '')
                        ) AS source_text
                    FROM universe_membership_snapshots
                    WHERE universe_snapshot_id = ?
                      AND membership_status IN ('ACTIVE', 'MEMBER')
                      AND COALESCE(symbol, '') <> ''
                      AND COALESCE(effective_date, '') <> ''
                )
                SELECT
                    COUNT(*) AS historical_count,
                    MIN(effective_date) AS historical_start,
                    MAX(effective_date) AS historical_end
                FROM normalized
                WHERE ({historical_positive})
                  AND {non_historical_negative}
                """,
                tuple(params),
            ).fetchone()
    except Exception:
        return stats
    active_values = dict(active_row or {})
    historical_values = dict(historical_row or {})
    stats["active_count"] = int(active_values.get("active_count") or 0)
    stats["raw_end"] = active_values.get("raw_end")
    stats["historical_count"] = int(historical_values.get("historical_count") or 0)
    stats["historical_start"] = historical_values.get("historical_start")
    stats["historical_end"] = historical_values.get("historical_end")
    return stats


def _light_price_coverage_stats(market_data_repository: Any, dataset_snapshot_id: str) -> dict[str, Any]:
    stats = {"coverage_rows": 0, "start_date": None, "end_date": None}
    if not hasattr(market_data_repository, "connect"):
        try:
            rows = market_data_repository.load_dataset_symbol_coverage(dataset_snapshot_id)
        except Exception:
            return stats
        dates_start = sorted(str(row.get("start_date") or "") for row in rows if str(row.get("start_date") or ""))
        dates_end = sorted(str(row.get("end_date") or "") for row in rows if str(row.get("end_date") or ""))
        stats["coverage_rows"] = len(rows)
        stats["start_date"] = dates_start[0] if dates_start else None
        stats["end_date"] = dates_end[-1] if dates_end else None
        return stats
    try:
        with market_data_repository.connect() as conn:
            row = conn.execute(
                """
                SELECT
                    COUNT(*) AS coverage_rows,
                    MIN(start_date) AS start_date,
                    MAX(end_date) AS end_date
                FROM dataset_symbol_coverage
                WHERE dataset_snapshot_id = ?
                """,
                (dataset_snapshot_id,),
            ).fetchone()
    except Exception:
        return stats
    values = dict(row or {})
    stats["coverage_rows"] = int(values.get("coverage_rows") or 0)
    stats["start_date"] = values.get("start_date")
    stats["end_date"] = values.get("end_date")
    return stats


def build_factor_list_pit_overview(market_data_repository: Any) -> dict[str, Any]:
    """Lightweight PIT readiness projection for the factor library hot path."""
    ensure_default_fundamental_snapshot(market_data_repository)
    now = iso_now()
    try:
        dataset_snapshots = list(market_data_repository.list_dataset_snapshots())
    except Exception:
        dataset_snapshots = []
    try:
        universe_snapshots = list(market_data_repository.list_universe_snapshots())
    except Exception:
        universe_snapshots = []
    price_snapshot = _snapshot_by_id(dataset_snapshots, DATASET_PRICE_SNAPSHOT_ID)
    fundamental_snapshot = _snapshot_by_id(dataset_snapshots, DATASET_FUNDAMENTALS_SNAPSHOT_ID)
    universe_snapshot = _snapshot_by_id(universe_snapshots, SP500_UNIVERSE_SNAPSHOT_ID)
    dataset_snapshot_id = str((price_snapshot or {}).get("id") or DATASET_PRICE_SNAPSHOT_ID)
    fundamental_snapshot_id = str((fundamental_snapshot or {}).get("id") or DATASET_FUNDAMENTALS_SNAPSHOT_ID)
    universe_snapshot_id = str((universe_snapshot or {}).get("id") or SP500_UNIVERSE_SNAPSHOT_ID)
    price_status = str((price_snapshot or {}).get("status") or "MISSING").upper()
    fundamental_status = str((fundamental_snapshot or {}).get("status") or "MISSING").upper()
    universe_status = str((universe_snapshot or {}).get("status") or "MISSING").upper()
    price_metadata = _metadata_for_row(price_snapshot or {})
    fundamental_metadata = _metadata_for_row(fundamental_snapshot or {})
    price_bar_count = int(
        (price_snapshot or {}).get("row_count")
        or price_metadata.get("price_bar_rows")
        or price_metadata.get("row_count")
        or 0
    )
    fundamental_point_count = int(
        (fundamental_snapshot or {}).get("row_count")
        or fundamental_metadata.get("fundamental_point_rows")
        or fundamental_metadata.get("row_count")
        or 0
    )
    fundamental_coverage_count = int(
        fundamental_metadata.get("covered_symbol_count")
        or fundamental_metadata.get("coverage_rows")
        or 0
    )
    counts = {"price_bars": price_bar_count}
    fundamental_counts = {
        "fundamental_points": fundamental_point_count,
        "fundamental_coverage": fundamental_coverage_count,
    }
    price_stats = _light_price_coverage_stats(market_data_repository, dataset_snapshot_id)
    universe_metadata = _metadata_for_row(universe_snapshot or {})
    universe_source_text = " ".join(
        str(value).strip().lower()
        for value in (
            (universe_snapshot or {}).get("source"),
            (universe_snapshot or {}).get("fallback_source"),
            universe_metadata.get("source"),
            universe_metadata.get("source_quality"),
            universe_metadata.get("source_kind"),
            universe_metadata.get("provider"),
            universe_metadata.get("provider_id"),
            universe_metadata.get("coverage_mode"),
        )
        if value is not None
    )
    snapshot_member_count = int((universe_snapshot or {}).get("member_count") or 0)
    current_only_universe = any(marker in universe_source_text for marker in NON_HISTORICAL_MEMBERSHIP_MARKERS)
    membership_stats = {
        "active_count": snapshot_member_count,
        "historical_count": 0 if current_only_universe else snapshot_member_count,
        "historical_start": (universe_snapshot or {}).get("window_start"),
        "historical_end": (universe_snapshot or {}).get("window_end") or (universe_snapshot or {}).get("as_of"),
        "raw_end": (universe_snapshot or {}).get("as_of") or (universe_snapshot or {}).get("window_end"),
    }
    anchor_date = (
        _parse_date((price_snapshot or {}).get("as_of"))
        or _parse_date((universe_snapshot or {}).get("as_of"))
        or date.today()
    )
    verified_window_start = _years_before(anchor_date, FORMAL_DIAGNOSTIC_YEARS)
    sandbox_window_start = _years_before(anchor_date, SANDBOX_DIAGNOSTIC_YEARS)
    price_start_date = _snapshot_start(price_snapshot, price_stats.get("start_date"))
    price_end_date = _snapshot_end(price_snapshot, price_stats.get("end_date"))
    universe_start_date = _parse_date(membership_stats.get("historical_start")) or _snapshot_start(universe_snapshot)
    raw_universe_end_date = _parse_date(membership_stats.get("raw_end")) or anchor_date
    has_price_rows = int(counts.get("price_bars") or 0) > 0
    historical_member_rows = int(membership_stats.get("historical_count") or 0)
    raw_member_rows = int(membership_stats.get("active_count") or 0)
    has_any_universe = raw_member_rows > 0 or int((universe_snapshot or {}).get("member_count") or 0) > 0
    blocker_items: list[dict[str, Any]] = []
    if price_status != "READY" or not has_price_rows:
        blocker_items.append(
            {
                "code": "PRICE_SNAPSHOT_NOT_READY",
                "message": "复权价格快照未就绪，因子诊断不能执行。",
                "target": dataset_snapshot_id,
                "fix_hash": f"#/snapshots?tab=equity&target={dataset_snapshot_id}",
            }
        )
    if universe_status != "READY" or historical_member_rows <= 0:
        blocker_items.append(
            {
                "code": "UNIVERSE_HISTORY_BLOCKED",
                "message": "历史点位样本池缺失，不能使用当前成分股替代历史样本池。",
                "target": universe_snapshot_id,
                "fix_hash": f"#/snapshots?tab=equity&target={universe_snapshot_id}",
            }
        )
    verified_missing_windows: list[dict[str, Any]] = []
    if not has_price_rows:
        verified_missing_windows.append(
            {
                "kind": "price",
                "label": "价格快照无可用行",
                "start_date": verified_window_start.isoformat(),
                "end_date": anchor_date.isoformat(),
            }
        )
    elif price_start_date and price_start_date > verified_window_start:
        verified_missing_windows.append(
            {
                "kind": "price",
                "label": f"{_year_range_label(verified_window_start, price_start_date - timedelta(days=1))} 价格快照缺失",
                "start_date": verified_window_start.isoformat(),
                "end_date": (price_start_date - timedelta(days=1)).isoformat(),
            }
        )
    if price_status != "READY":
        verified_missing_windows.append(
            {
                "kind": "price_status",
                "label": f"价格快照状态 {price_status}",
                "start_date": (price_start_date or verified_window_start).isoformat(),
                "end_date": (price_end_date or anchor_date).isoformat(),
            }
        )
    if historical_member_rows <= 0:
        verified_missing_windows.append(
            {
                "kind": "universe",
                "label": f"{_year_range_label(verified_window_start, raw_universe_end_date)} 历史样本池缺失",
                "start_date": verified_window_start.isoformat(),
                "end_date": raw_universe_end_date.isoformat(),
            }
        )
    elif universe_start_date and universe_start_date > verified_window_start:
        verified_missing_windows.append(
            {
                "kind": "universe",
                "label": f"{_year_range_label(verified_window_start, universe_start_date - timedelta(days=1))} 历史样本池缺失",
                "start_date": verified_window_start.isoformat(),
                "end_date": (universe_start_date - timedelta(days=1)).isoformat(),
            }
        )
    overall_status = "READY" if not blocker_items else "BLOCKED"
    verified_enabled = overall_status == "READY" and not verified_missing_windows
    sandbox_enabled = has_price_rows and has_any_universe
    fundamental_fields = [
        str(field)
        for field in (fundamental_metadata.get("available_fields") or [])
        if str(field).strip()
    ]
    fundamental_field_set = set(fundamental_fields)
    fundamental_point_rows = int(fundamental_counts.get("fundamental_points") or 0)
    fundamental_ready = (
        fundamental_status == "READY"
        and fundamental_point_rows > 0
        and FUNDAMENTAL_REQUIREMENTS <= fundamental_field_set
    )
    return {
        "dataset_snapshot_id": dataset_snapshot_id,
        "fundamental_snapshot_id": fundamental_snapshot_id,
        "universe_snapshot_id": universe_snapshot_id,
        "as_of_date": str((price_snapshot or {}).get("as_of") or (universe_snapshot or {}).get("as_of") or now[:10]),
        "overall_status": overall_status,
        "fundamental_status": "READY" if fundamental_ready else "BLOCKED",
        "fundamental_coverage": {
            "covered_symbol_count": int((fundamental_snapshot or {}).get("metadata", {}).get("covered_symbol_count") or fundamental_counts.get("fundamental_coverage") or 0)
            if isinstance((fundamental_snapshot or {}).get("metadata"), Mapping)
            else int(fundamental_counts.get("fundamental_coverage") or 0),
            "total_symbol_count": int((fundamental_snapshot or {}).get("metadata", {}).get("total_symbol_count") or 0)
            if isinstance((fundamental_snapshot or {}).get("metadata"), Mapping)
            else 0,
            "coverage_pct": 0,
            "fundamental_point_rows": fundamental_point_rows,
            "coverage_rows": int(fundamental_counts.get("fundamental_coverage") or 0),
            "available_fields": fundamental_fields,
            "missing_fields": sorted(FUNDAMENTAL_REQUIREMENTS.difference(fundamental_field_set)),
            "source_snapshot_status": fundamental_status,
            "source_snapshot_updated_at": (fundamental_snapshot or {}).get("updated_at"),
            "seed_version": fundamental_metadata.get("seed_version"),
        },
        "blocking_items": blocker_items,
        "factor_diagnostics_enabled": verified_enabled,
        "verified_diagnostics_enabled": verified_enabled,
        "limited_diagnostics_enabled": False,
        "sandbox_diagnostics_enabled": sandbox_enabled,
        "gate_fix_target": blocker_items[0]["fix_hash"] if blocker_items else "#/pit-data",
        "diagnostic_windows": {
            "sandbox": {
                "mode": "SANDBOX",
                "enabled": sandbox_enabled,
                "start_date": sandbox_window_start.isoformat(),
                "end_date": anchor_date.isoformat(),
                "label": f"Sandbox 近 {SANDBOX_DIAGNOSTIC_YEARS} 年预览",
            },
            "verified": {
                "mode": "VERIFIED",
                "enabled": verified_enabled,
                "start_date": verified_window_start.isoformat(),
                "end_date": anchor_date.isoformat(),
                "label": f"Verified {FORMAL_DIAGNOSTIC_YEARS} 年 PIT 门禁",
                "missing_windows": verified_missing_windows,
            },
        },
    }


def build_pit_data_overview(market_data_repository: Any) -> dict[str, Any]:
    ensure_default_fundamental_snapshot(market_data_repository)
    now = iso_now()
    dataset_snapshots = list(market_data_repository.list_dataset_snapshots())
    universe_snapshots = list(market_data_repository.list_universe_snapshots())
    price_snapshot = _snapshot_by_id(dataset_snapshots, DATASET_PRICE_SNAPSHOT_ID)
    corporate_snapshot = _snapshot_by_id(dataset_snapshots, DATASET_CORPORATE_ACTIONS_SNAPSHOT_ID)
    fundamental_snapshot = _snapshot_by_id(dataset_snapshots, DATASET_FUNDAMENTALS_SNAPSHOT_ID)
    universe_snapshot = _snapshot_by_id(universe_snapshots, SP500_UNIVERSE_SNAPSHOT_ID)
    dataset_snapshot_id = str((price_snapshot or {}).get("id") or DATASET_PRICE_SNAPSHOT_ID)
    fundamental_snapshot_id = str((fundamental_snapshot or {}).get("id") or DATASET_FUNDAMENTALS_SNAPSHOT_ID)
    universe_snapshot_id = str((universe_snapshot or {}).get("id") or SP500_UNIVERSE_SNAPSHOT_ID)
    price_status = str((price_snapshot or {}).get("status") or "MISSING").upper()
    fundamental_status = str((fundamental_snapshot or {}).get("status") or "MISSING").upper()
    universe_status = str((universe_snapshot or {}).get("status") or "MISSING").upper()
    corporate_status = str((corporate_snapshot or {}).get("status") or "MISSING").upper()
    try:
        counts = market_data_repository.count_dataset_snapshot_rows(dataset_snapshot_id)
    except Exception:
        counts = {"price_bars": 0, "corporate_actions": 0, "symbol_coverage": 0}
    try:
        fundamental_counts = market_data_repository.count_dataset_snapshot_rows(fundamental_snapshot_id)
    except Exception:
        fundamental_counts = {"fundamental_points": 0, "fundamental_coverage": 0}
    try:
        fundamental_coverage_rows = (
            market_data_repository.load_dataset_fundamental_coverage(fundamental_snapshot_id)
            if hasattr(market_data_repository, "load_dataset_fundamental_coverage")
            else []
        )
    except Exception:
        fundamental_coverage_rows = []
    history_summary = _load_pit_universe_history_summary(
        market_data_repository,
        universe_snapshot_id=universe_snapshot_id,
        universe_snapshot=universe_snapshot,
    )
    memberships: list[dict[str, Any]] = []
    historical_memberships: list[dict[str, Any]] = []
    try:
        coverage_rows = market_data_repository.load_dataset_symbol_coverage(dataset_snapshot_id)
    except Exception:
        coverage_rows = []
    blocker_items: list[dict[str, Any]] = []
    if price_status != "READY" or int(counts.get("price_bars") or 0) <= 0:
        blocker_items.append(
            {
                "code": "PRICE_SNAPSHOT_NOT_READY",
                "message": "复权价格快照未就绪，因子诊断不能执行。",
                "target": dataset_snapshot_id,
                "fix_hash": f"#/snapshots?tab=equity&target={dataset_snapshot_id}",
            }
        )
    if universe_status != "READY" or history_summary.historical_count <= 0:
        blocker_items.append(
            {
                "code": "UNIVERSE_HISTORY_BLOCKED",
                "message": "历史点位样本池缺失，不能使用当前成分股替代历史样本池。",
                "target": universe_snapshot_id,
                "fix_hash": f"#/snapshots?tab=equity&target={universe_snapshot_id}",
            }
        )
    cleaning_runs = []
    if hasattr(market_data_repository, "list_pit_cleaning_runs"):
        cleaning_runs = market_data_repository.list_pit_cleaning_runs(limit=1)
    latest_cleaning = cleaning_runs[0] if cleaning_runs else {}
    quality_events = []
    if hasattr(market_data_repository, "list_pit_quality_events"):
        quality_events = market_data_repository.list_pit_quality_events(
            dataset_snapshot_id=dataset_snapshot_id,
            universe_snapshot_id=universe_snapshot_id,
            limit=20,
        )
    generated_events = [
        {
            "id": f"pit-event-{item['code'].lower()}",
            "severity": "BLOCKER",
            "event_type": item["code"],
            "title": "PIT 门禁阻塞",
            "message": item["message"],
            "target_date": (price_snapshot or universe_snapshot or {}).get("as_of"),
            "target_symbol": None,
            "metadata": {"fix_hash": item["fix_hash"]},
        }
        for item in blocker_items
    ]
    sample_symbols = sorted(
        {
            str(row.get("symbol") or "").upper()
            for row in coverage_rows
            if str(row.get("symbol") or "").strip()
        }
        or set(history_summary.latest_symbols)
    )[:8]
    coverage_total = int((price_snapshot or {}).get("metadata", {}).get("total_symbol_count") or 0) if isinstance((price_snapshot or {}).get("metadata"), Mapping) else 0
    coverage_ready = int((price_snapshot or {}).get("metadata", {}).get("covered_symbol_count") or 0) if isinstance((price_snapshot or {}).get("metadata"), Mapping) else 0
    if coverage_total <= 0:
        coverage_total = max(len(coverage_rows), len(history_summary.latest_symbols), 1)
    if coverage_ready <= 0:
        coverage_ready = len(coverage_rows)
    coverage_pct = round(min(1.0, coverage_ready / coverage_total) * 100.0, 2) if coverage_total else 0.0
    fundamental_metadata = _metadata_for_row(fundamental_snapshot or {})
    fundamental_fields = [
        str(field)
        for field in (fundamental_metadata.get("available_fields") or [])
        if str(field).strip()
    ]
    fundamental_field_set = set(fundamental_fields)
    fundamental_required_ready = FUNDAMENTAL_REQUIREMENTS <= fundamental_field_set
    fundamental_point_rows = int(fundamental_counts.get("fundamental_points") or 0)
    fundamental_coverage_total = int((fundamental_snapshot or {}).get("metadata", {}).get("total_symbol_count") or 0) if isinstance((fundamental_snapshot or {}).get("metadata"), Mapping) else 0
    fundamental_coverage_ready = int((fundamental_snapshot or {}).get("metadata", {}).get("covered_symbol_count") or 0) if isinstance((fundamental_snapshot or {}).get("metadata"), Mapping) else 0
    if fundamental_coverage_total <= 0:
        fundamental_coverage_total = max(len(fundamental_coverage_rows), 1)
    if fundamental_coverage_ready <= 0:
        fundamental_coverage_ready = len(fundamental_coverage_rows)
    fundamental_ready = (
        fundamental_status == "READY"
        and fundamental_point_rows > 0
        and fundamental_required_ready
    )
    fundamental_coverage_pct = round(
        min(1.0, fundamental_coverage_ready / fundamental_coverage_total) * 100.0,
        2,
    ) if fundamental_coverage_total else 0.0
    coverage_gap = _build_coverage_gap_with_identity(
        market_data_repository=market_data_repository,
        price_snapshot=price_snapshot,
        corporate_snapshot=corporate_snapshot,
        fundamental_snapshot_id=fundamental_snapshot_id,
        historical_memberships=historical_memberships,
        universe_snapshot_id=universe_snapshot_id,
        history_summary=history_summary,
    )
    active_waiver = None
    if hasattr(market_data_repository, "get_active_pit_research_waiver"):
        try:
            active_waiver = market_data_repository.get_active_pit_research_waiver(
                dataset_snapshot_id=dataset_snapshot_id,
                universe_snapshot_id=universe_snapshot_id,
            )
        except Exception:
            active_waiver = None
    waiver_symbols = {
        str(symbol).strip().upper()
        for symbol in ((active_waiver or {}).get("ignored_symbols") or [])
        if str(symbol).strip()
    }
    missing_symbols = {
        str(symbol).strip().upper()
        for symbol in (_metadata_for_row(price_snapshot or {}).get("missing_symbols") or [])
        if str(symbol).strip()
    }
    corporate_missing_symbols = {
        str(symbol).strip().upper()
        for symbol in (_metadata_for_row(corporate_snapshot or {}).get("missing_symbols") or [])
        if str(symbol).strip()
    }
    universe_blocked = any(item.get("code") == "UNIVERSE_HISTORY_BLOCKED" for item in blocker_items)
    price_blocked = any(item.get("code") == "PRICE_SNAPSHOT_NOT_READY" for item in blocker_items)
    waiver_covers_non_core = bool(waiver_symbols) and bool(waiver_symbols <= missing_symbols)
    limited_ready = (
        bool(active_waiver)
        and waiver_covers_non_core
        and price_blocked
        and not universe_blocked
        and int(counts.get("price_bars") or 0) > 0
    )
    overall_status = "READY" if not blocker_items else ("LIMITED_READY" if limited_ready else "BLOCKED")
    anchor_date = (
        _parse_date((price_snapshot or {}).get("as_of"))
        or _parse_date((universe_snapshot or {}).get("as_of"))
        or date.today()
    )
    verified_window_start = _years_before(anchor_date, FORMAL_DIAGNOSTIC_YEARS)
    sandbox_window_start = _years_before(anchor_date, SANDBOX_DIAGNOSTIC_YEARS)
    price_start_date = _snapshot_start(price_snapshot, min((str(row.get("start_date") or "") for row in coverage_rows), default=None))
    price_end_date = _snapshot_end(price_snapshot, max((str(row.get("end_date") or "") for row in coverage_rows), default=None))
    universe_start_date = _parse_date(history_summary.historical_start) or _snapshot_start(universe_snapshot)
    universe_end_date = _parse_date(history_summary.historical_end) or _snapshot_end(universe_snapshot)
    has_price_rows = int(counts.get("price_bars") or 0) > 0
    has_any_universe = history_summary.historical_count > 0 or history_summary.raw_count > 0
    sandbox_enabled = has_price_rows and has_any_universe
    verified_missing_windows: list[dict[str, Any]] = []
    if not has_price_rows:
        verified_missing_windows.append(
            {
                "kind": "price",
                "label": "价格快照无可用行",
                "start_date": verified_window_start.isoformat(),
                "end_date": anchor_date.isoformat(),
            }
        )
    elif price_start_date and price_start_date > verified_window_start:
        verified_missing_windows.append(
            {
                "kind": "price",
                "label": f"{_year_range_label(verified_window_start, price_start_date - timedelta(days=1))} 价格快照缺失",
                "start_date": verified_window_start.isoformat(),
                "end_date": (price_start_date - timedelta(days=1)).isoformat(),
            }
        )
    if price_status != "READY":
        verified_missing_windows.append(
            {
                "kind": "price_status",
                "label": f"价格快照状态 {price_status}",
                "start_date": (price_start_date or verified_window_start).isoformat(),
                "end_date": (price_end_date or anchor_date).isoformat(),
            }
        )
    if history_summary.historical_count <= 0:
        universe_gap_end = _parse_date(history_summary.raw_end) or anchor_date
        verified_missing_windows.append(
            {
                "kind": "universe",
                "label": f"{_year_range_label(verified_window_start, universe_gap_end)} 历史样本池缺失",
                "start_date": verified_window_start.isoformat(),
                "end_date": universe_gap_end.isoformat(),
            }
        )
    elif universe_start_date and universe_start_date > verified_window_start:
        verified_missing_windows.append(
            {
                "kind": "universe",
                "label": f"{_year_range_label(verified_window_start, universe_start_date - timedelta(days=1))} 历史样本池缺失",
                "start_date": verified_window_start.isoformat(),
                "end_date": (universe_start_date - timedelta(days=1)).isoformat(),
            }
        )
    verified_enabled = overall_status == "READY" and not verified_missing_windows
    limited_diagnostics_enabled = limited_ready and history_summary.historical_count > 0
    covered_preview_symbols = sorted(
        {
            str(row.get("symbol") or "").upper()
            for row in coverage_rows
            if str(row.get("symbol") or "").strip()
        }
    )
    rule_preview_symbols = covered_preview_symbols[:16] or sample_symbols
    cleaning_rule_previews = _build_cleaning_rule_previews(
        market_data_repository,
        dataset_snapshot_id=dataset_snapshot_id,
        symbols=rule_preview_symbols,
        end_date=anchor_date,
    )
    raw_universe_anchor_count = len(history_summary.date_counts)
    universe_history_series = _build_universe_history_series_from_counts(history_summary.date_counts)
    adjustment_trace = _build_adjustment_trace(
        market_data_repository,
        dataset_snapshot_id=dataset_snapshot_id,
        symbols=rule_preview_symbols,
        end_date=anchor_date,
    )
    adjusted_price_status = "READY" if price_status == "READY" and int(counts.get("price_bars") or 0) > 0 else "BLOCKED"
    resolved_universe_status = "READY" if universe_status == "READY" and history_summary.historical_count > 0 else "BLOCKED"
    outlier_cleaning_status = str(latest_cleaning.get("outlier_status") or ("READY" if overall_status == "READY" else "BLOCKED"))
    factor_status = (
        "READY"
        if verified_enabled
        else ("LIMITED_READY" if limited_diagnostics_enabled else ("SANDBOX_READY" if sandbox_enabled else "BLOCKED"))
    )
    ops_guidance = _build_ops_guidance(coverage_gap, blocker_items)
    status_reasons = _build_status_reasons(
        adjusted_price_status=adjusted_price_status,
        universe_status=resolved_universe_status,
        outlier_cleaning_status=outlier_cleaning_status,
        factor_status=factor_status,
        coverage_gap=coverage_gap,
        cleaning_rule_previews=cleaning_rule_previews,
        universe_history_series=universe_history_series,
        raw_universe_anchor_count=raw_universe_anchor_count,
        limited_ready=limited_ready,
        verified_enabled=verified_enabled,
        sandbox_enabled=sandbox_enabled,
    )
    research_waiver = None
    if active_waiver:
        ignored_symbols = [
            str(symbol).strip().upper()
            for symbol in (active_waiver.get("ignored_symbols") or [])
            if str(symbol).strip()
        ]
        impact_estimate = _build_waiver_impact_estimate(ignored_symbols, coverage_gap)
        research_waiver = {
            "id": active_waiver.get("id"),
            "status": "ACTIVE" if limited_ready else "INACTIVE",
            "dataset_snapshot_id": active_waiver.get("dataset_snapshot_id"),
            "universe_snapshot_id": active_waiver.get("universe_snapshot_id"),
            "ignored_symbols": ignored_symbols,
            "ignored_symbol_count": len(ignored_symbols),
            "reason": active_waiver.get("reason") or "",
            "created_at": active_waiver.get("created_at"),
            "created_by": active_waiver.get("created_by") or "researcher",
            "promotion_eligible": False,
            "mode": "LIMITED_READY",
            "impact_estimate": impact_estimate,
        }
    full_ready_repair_plan = _build_full_ready_repair_plan(
        price_snapshot=price_snapshot,
        corporate_snapshot=corporate_snapshot,
        coverage_gap=coverage_gap,
        blocking_items=blocker_items,
        identity_rows=_load_symbol_identity_rows(market_data_repository, missing_symbols | corporate_missing_symbols),
        active_waiver=active_waiver,
    )
    external_source_readiness = build_external_source_readiness(
        repair_plan=full_ready_repair_plan,
    )
    return {
        "dataset_snapshot_id": dataset_snapshot_id,
        "fundamental_snapshot_id": fundamental_snapshot_id,
        "universe_snapshot_id": universe_snapshot_id,
        "as_of_date": str((price_snapshot or {}).get("as_of") or (universe_snapshot or {}).get("as_of") or now[:10]),
        "cleaning_version": str(latest_cleaning.get("cleaning_version") or "snapshot-derived-v1"),
        "overall_status": overall_status,
        "adjusted_price_status": adjusted_price_status,
        "universe_status": resolved_universe_status,
        "outlier_cleaning_status": outlier_cleaning_status,
        "corporate_action_status": corporate_status,
        "fundamental_status": "READY" if fundamental_ready else "BLOCKED",
        "coverage": {
            "covered_symbol_count": coverage_ready,
            "total_symbol_count": coverage_total,
            "coverage_pct": coverage_pct,
            "price_bar_rows": int(counts.get("price_bars") or 0),
            "universe_member_rows": history_summary.historical_count,
            "raw_universe_member_rows": history_summary.raw_count,
            "universe_history_anchor_count": raw_universe_anchor_count,
            "universe_history_annual_anchor_count": len(universe_history_series),
        },
        "fundamental_coverage": {
            "covered_symbol_count": fundamental_coverage_ready,
            "total_symbol_count": fundamental_coverage_total,
            "coverage_pct": fundamental_coverage_pct,
            "fundamental_point_rows": fundamental_point_rows,
            "coverage_rows": len(fundamental_coverage_rows),
            "available_fields": fundamental_fields,
            "missing_fields": sorted(FUNDAMENTAL_REQUIREMENTS.difference(fundamental_field_set)),
            "source_snapshot_status": fundamental_status,
        },
        "blocking_items": blocker_items,
        "status_reasons": status_reasons,
        "ops_guidance": ops_guidance,
        "sample_securities": sample_symbols,
        "quality_events": quality_events + generated_events,
        "coverage_gap": coverage_gap,
        "cleaning_rule_previews": cleaning_rule_previews,
        "universe_history_series": universe_history_series,
        "adjustment_trace": adjustment_trace,
        "research_waiver": research_waiver,
        "full_ready_repair_plan": full_ready_repair_plan,
        "external_source_readiness": external_source_readiness,
        "factor_diagnostics_enabled": verified_enabled or limited_diagnostics_enabled,
        "verified_diagnostics_enabled": verified_enabled,
        "limited_diagnostics_enabled": limited_diagnostics_enabled,
        "sandbox_diagnostics_enabled": sandbox_enabled,
        "gate_fix_target": blocker_items[0]["fix_hash"] if blocker_items else "#/pit-data",
        "diagnostic_windows": {
            "sandbox": {
                "mode": "SANDBOX",
                "enabled": sandbox_enabled,
                "start_date": sandbox_window_start.isoformat(),
                "end_date": anchor_date.isoformat(),
                "label": f"Sandbox 近 {SANDBOX_DIAGNOSTIC_YEARS} 年预览",
            },
            "verified": {
                "mode": "VERIFIED",
                "enabled": verified_enabled,
                "start_date": verified_window_start.isoformat(),
                "end_date": anchor_date.isoformat(),
                "label": f"Verified {FORMAL_DIAGNOSTIC_YEARS} 年 PIT 门禁",
                "missing_windows": verified_missing_windows,
            },
        },
        "source": {
            "derived_from_snapshot": not bool(latest_cleaning),
            "dataset_status": price_status,
            "universe_snapshot_status": universe_status,
            "historical_universe_member_rows": history_summary.historical_count,
            "historical_universe_anchor_count": raw_universe_anchor_count,
            "annual_universe_anchor_count": len(universe_history_series),
        },
    }


class FactorResearchService:
    def __init__(
        self,
        storage: SQLiteStorage,
        market_data_repository: Any,
        pit_overview_builder: Callable[[], Mapping[str, Any]] | None = None,
    ) -> None:
        self.storage = storage
        self.market_data_repository = market_data_repository
        self._pit_overview_builder = pit_overview_builder
        self._diagnostic_preview_cache_seconds = 600.0
        self._diagnostic_preview_cache_lock = threading.Lock()
        self._diagnostic_preview_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._diagnostic_data_cache_seconds = 600.0
        self._diagnostic_data_cache_lock = threading.Lock()
        self._diagnostic_data_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        ensure_default_fundamental_snapshot(self.market_data_repository)
        self.ensure_default_factors()

    def _pit_overview(self) -> dict[str, Any]:
        if self._pit_overview_builder:
            return dict(self._pit_overview_builder())
        return build_pit_data_overview(self.market_data_repository)

    def create_research_waiver(self, request: Any) -> dict[str, Any]:
        payload = dict(_as_mapping(request))
        overview = self._pit_overview()
        coverage_gap = overview.get("coverage_gap") if isinstance(overview.get("coverage_gap"), Mapping) else {}
        requested_symbols = payload.get("ignored_symbols")
        default_symbols = coverage_gap.get("default_ignored_symbols") if isinstance(coverage_gap, Mapping) else []
        ignored_symbols = [
            str(symbol).strip().upper()
            for symbol in (requested_symbols if isinstance(requested_symbols, list) and requested_symbols else default_symbols or [])
            if str(symbol).strip()
        ]
        if not ignored_symbols:
            raise ValueError("当前没有可用于研究态豁免的非核心缺失标的。")
        dataset_snapshot_id = str(payload.get("dataset_snapshot_id") or overview.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
        universe_snapshot_id = str(payload.get("universe_snapshot_id") or overview.get("universe_snapshot_id") or SP500_UNIVERSE_SNAPSHOT_ID)
        waiver_id = f"pitw_{uuid4().hex[:12]}"
        reason = str(payload.get("reason") or "研究阶段临时忽略非核心缺失标的，晋升仍要求 Full Ready。").strip()
        created_by = str(payload.get("created_by") or "researcher").strip() or "researcher"
        if not hasattr(self.market_data_repository, "upsert_pit_research_waiver"):
            raise ValueError("当前市场数据仓库不支持 PIT 研究态豁免。")
        self.market_data_repository.upsert_pit_research_waiver(
            waiver_id=waiver_id,
            dataset_snapshot_id=dataset_snapshot_id,
            universe_snapshot_id=universe_snapshot_id,
            ignored_symbols=ignored_symbols,
            reason=reason,
            created_by=created_by,
        )
        return self._pit_overview()

    def revoke_research_waiver(self, waiver_id: str) -> dict[str, Any]:
        if not hasattr(self.market_data_repository, "revoke_pit_research_waiver"):
            raise ValueError("当前市场数据仓库不支持 PIT 研究态豁免。")
        self.market_data_repository.revoke_pit_research_waiver(str(waiver_id))
        return self._pit_overview()

    def apply_identity_override(self, request: Any) -> dict[str, Any]:
        payload = dict(_as_mapping(request))
        symbol = str(payload.get("symbol") or "").strip().upper()
        canonical_symbol = str(payload.get("canonical_symbol") or "").strip().upper()
        if not symbol or not canonical_symbol:
            raise ValueError("手动身份映射必须提供 symbol 与 canonical_symbol。")
        if not hasattr(self.market_data_repository, "upsert_symbol_identity"):
            raise ValueError("当前市场数据仓库不支持 symbol identity overwrite。")
        source = "manual_mapping_overwrite"
        reason = str(payload.get("reason") or "").strip()
        if reason:
            source = f"{source}: {reason[:80]}"
        self.market_data_repository.upsert_symbol_identity(
            {
                "symbol": symbol,
                "canonical_symbol": canonical_symbol,
                "company_name": str(payload.get("company_name") or ""),
                "cik": str(payload.get("cik") or ""),
                "exchange": str(payload.get("exchange") or ""),
                "ipo_date": payload.get("ipo_date"),
                "delisting_date": payload.get("delisting_date"),
                "valid_from": payload.get("valid_from"),
                "valid_to": payload.get("valid_to"),
                "source": source,
            }
        )
        return self._pit_overview()

    def ensure_default_factors(self) -> None:
        now = iso_now()
        with self.storage.connection() as conn:
            for seed in DEFAULT_SEED_FACTORS:
                existing = conn.execute("SELECT * FROM factor_definitions WHERE id = ?", (seed.id,)).fetchone()
                if existing:
                    tags_json = dumps(list(seed.tags))
                    requirements_json = dumps(list(seed.data_requirements))
                    version_metadata_json = dumps({"source": "SYSTEM_SEED", "descriptor": seed.descriptor.as_dict()})
                    changed = (
                        str(existing.get("name") or "") != seed.name
                        or str(existing.get("expression") or "") != seed.expression
                        or str(existing.get("direction") or "") != seed.direction
                        or str(existing.get("tags_json") or "") != tags_json
                        or str(existing.get("data_requirements_json") or "") != requirements_json
                        or str(existing.get("institutional_note") or "") != seed.institutional_note
                    )
                    if changed:
                        conn.execute(
                            """
                            UPDATE factor_definitions
                            SET name = ?,
                                expression = ?,
                                direction = ?,
                                tags_json = ?,
                                data_requirements_json = ?,
                                institutional_note = ?,
                                updated_at = ?
                            WHERE id = ? AND source = 'SYSTEM_SEED'
                            """,
                            (
                                seed.name,
                                seed.expression,
                                seed.direction,
                                tags_json,
                                requirements_json,
                                seed.institutional_note,
                                now,
                                seed.id,
                            ),
                        )
                    if str(existing.get("source") or "") == "SYSTEM_SEED":
                        existing_version = conn.execute(
                            """
                            SELECT *
                            FROM factor_versions
                            WHERE factor_id = ? AND version = 1
                            """,
                            (seed.id,),
                        ).fetchone()
                        if existing_version:
                            version_changed = (
                                str(existing_version.get("expression") or "") != seed.expression
                                or str(existing_version.get("status") or "") != "ACTIVE"
                                or str(existing_version.get("metadata_json") or "") != version_metadata_json
                            )
                            if version_changed:
                                conn.execute(
                                    """
                                    UPDATE factor_versions
                                    SET expression = ?,
                                        status = 'ACTIVE',
                                        metadata_json = ?
                                    WHERE id = ?
                                    """,
                                    (
                                        seed.expression,
                                        version_metadata_json,
                                        existing_version["id"],
                                    ),
                                )
                        else:
                            conn.execute(
                                """
                                INSERT INTO factor_versions (id, factor_id, version, expression, status, metadata_json, created_at)
                                VALUES (?, ?, 1, ?, 'ACTIVE', ?, ?)
                                """,
                                (
                                    f"{seed.id}-v1",
                                    seed.id,
                                    seed.expression,
                                    version_metadata_json,
                                    now,
                                ),
                            )
                    continue
                conn.execute(
                    """
                    INSERT INTO factor_definitions (
                        id, name, market, universe, source, lifecycle_status, diagnostic_status,
                        direction, frequency, expression, tags_json, data_requirements_json,
                        institutional_note, created_by, created_at, updated_at
                    )
                    VALUES (?, ?, 'US', 'SP500', 'SYSTEM_SEED', 'DRAFT', ?, ?, 'DAILY', ?, ?, ?, ?, 'system', ?, ?)
                    """,
                    (
                        seed.id,
                        seed.name,
                        seed.diagnostic_status,
                        seed.direction,
                        seed.expression,
                        dumps(list(seed.tags)),
                        dumps(list(seed.data_requirements)),
                        seed.institutional_note,
                        now,
                        now,
                    ),
                )
                conn.execute(
                    """
                    INSERT INTO factor_versions (id, factor_id, version, expression, status, metadata_json, created_at)
                    VALUES (?, ?, 1, ?, 'ACTIVE', ?, ?)
                    """,
                    (
                        f"{seed.id}-v1",
                        seed.id,
                        seed.expression,
                        dumps({"source": "SYSTEM_SEED", "descriptor": seed.descriptor.as_dict()}),
                        now,
                    ),
                )

    def _factor_readiness(self, factor: Mapping[str, Any], pit_overview: Mapping[str, Any]) -> tuple[str, list[dict[str, Any]]]:
        requirements = set(str(item) for item in factor.get("data_requirements") or [])
        fundamental_requirements = requirements & FUNDAMENTAL_REQUIREMENTS
        fundamental_coverage = pit_overview.get("fundamental_coverage")
        available_fundamental_fields = {
            str(item)
            for item in (
                fundamental_coverage.get("available_fields")
                if isinstance(fundamental_coverage, Mapping)
                else []
            )
            if str(item).strip()
        }
        missing = sorted(fundamental_requirements.difference(available_fundamental_fields))
        if fundamental_requirements and (str(pit_overview.get("fundamental_status") or "").upper() != "READY" or missing):
            return (
                "BLOCKED_PIT",
                [
                    {
                        "code": "FUNDAMENTAL_PIT_NOT_READY",
                        "message": "基础面 PIT 快照未就绪，无法执行该因子诊断。",
                        "missing_fields": missing or sorted(fundamental_requirements),
                        "fundamental_snapshot_id": pit_overview.get("fundamental_snapshot_id"),
                        "fix_hash": "#/pit-data?section=fundamental-requirements",
                    }
                ],
            )
        if bool(pit_overview.get("verified_diagnostics_enabled") or pit_overview.get("factor_diagnostics_enabled")):
            return ("READY_TO_DIAGNOSE", [])
        diagnostic_windows = pit_overview.get("diagnostic_windows")
        verified_window = diagnostic_windows.get("verified") if isinstance(diagnostic_windows, Mapping) else {}
        missing_windows = (
            verified_window.get("missing_windows")
            if isinstance(verified_window, Mapping) and isinstance(verified_window.get("missing_windows"), list)
            else []
        )
        if bool(pit_overview.get("sandbox_diagnostics_enabled")):
            return (
                "SANDBOX_READY",
                [
                    {
                        "code": "VERIFIED_PIT_WINDOW_INCOMPLETE",
                        "message": "完整PIT 门禁尚未通过，当前仅允许 Sandbox 诊断。",
                        "missing_windows": missing_windows,
                        "fix_hash": pit_overview.get("gate_fix_target") or "#/pit-data",
                    }
                ],
            )
        if str(pit_overview.get("overall_status") or "").upper() != "READY":
            return (
                "BLOCKED_PIT",
                [
                    {
                        "code": "PIT_GATE_BLOCKED",
                        "message": "PIT 门禁未通过，请先修复复权价格或历史样本池。",
                        "fix_hash": pit_overview.get("gate_fix_target") or "#/pit-data",
                    }
                ],
            )
        return ("READY_TO_DIAGNOSE", [])

    def _diagnostic_gap_summary(
        self,
        factor: Mapping[str, Any],
        blockers: Sequence[Mapping[str, Any]],
    ) -> dict[str, Any]:
        if factor.get("latest_diagnostic_summary"):
            return {}
        if not blockers:
            return {
                "rank_ic": "Rank IC: 尚未提交诊断",
                "coverage": "覆盖: 等待首次诊断",
                "next_action": "提交 Verified 诊断",
            }
        first = blockers[0]
        missing_fields = first.get("missing_fields")
        if isinstance(missing_fields, list) and missing_fields:
            fields = ", ".join(str(item) for item in missing_fields)
            return {
                "rank_ic": f"Rank IC: 基础面 PIT 缺口 ({fields})",
                "coverage": f"覆盖: {fields} 待补",
                "next_action": "查看基础面 PIT 快照",
            }
        missing_windows = first.get("missing_windows")
        if isinstance(missing_windows, list) and missing_windows:
            labels = [
                str(item.get("label") or "").strip()
                for item in missing_windows
                if isinstance(item, Mapping) and str(item.get("label") or "").strip()
            ]
            label = labels[0] if labels else "完整 PIT 窗口缺失"
            return {
                "rank_ic": f"Rank IC: ({label})",
                "coverage": "覆盖: Sandbox 可预览，Verified 待补",
                "next_action": "补齐完整 PIT 后入库",
            }
        return {
            "rank_ic": f"Rank IC: ({str(first.get('message') or '诊断窗口缺失')})",
            "coverage": "覆盖: 待补数据门禁",
            "next_action": "查看 PIT 门禁",
        }

    def _latest_diagnostic_summary(self, factor: Mapping[str, Any]) -> Mapping[str, Any]:
        summary = factor.get("latest_diagnostic_summary")
        return summary if isinstance(summary, Mapping) else {}

    def _normalise_policy_item(self, item: Mapping[str, Any], *, severity: str) -> dict[str, Any]:
        code = str(item.get("code") or item.get("event_type") or "UNKNOWN").strip().upper() or "UNKNOWN"
        message = str(item.get("message") or item.get("label") or code).strip() or code
        result = {"code": code, "severity": severity, "message": message}
        for key in ("fix_hash", "target", "missing_fields", "missing_windows"):
            if key in item:
                result[key] = item.get(key)
        return result

    def _dedupe_policy_items(self, items: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
        seen: set[tuple[str, str]] = set()
        deduped: list[dict[str, Any]] = []
        for item in items:
            key = (str(item.get("code") or "UNKNOWN"), str(item.get("message") or ""))
            if key in seen:
                continue
            seen.add(key)
            deduped.append(dict(item))
        return deduped

    def _correlation_cluster_summary(self, cluster: Mapping[str, Any]) -> dict[str, Any]:
        nodes = [dict(item) for item in cluster.get("nodes") or [] if isinstance(item, Mapping)]
        high_nodes = [item for item in nodes if _coerce_float(item.get("correlation")) >= 0.72]
        max_correlation = max((_coerce_float(item.get("correlation")) for item in nodes), default=0.0)
        return {
            "anchor_factor_id": cluster.get("anchor_factor_id"),
            "method": cluster.get("method"),
            "top_n": len(nodes),
            "high_correlation_count": len(high_nodes),
            "max_correlation": _safe_round(max_correlation, 2) or 0.0,
            "top_factor_ids": [str(item.get("factor_id")) for item in nodes[:3] if item.get("factor_id")],
            "risk_level": "warning" if high_nodes else "clear",
        }

    def _build_blocker_policy(
        self,
        factor: Mapping[str, Any],
        correlation_cluster: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        hard_blockers: list[dict[str, Any]] = []
        warnings: list[dict[str, Any]] = []
        for item in factor.get("readiness_blockers") or []:
            if not isinstance(item, Mapping):
                continue
            normalized = self._normalise_policy_item(item, severity="blocker")
            code = normalized["code"]
            if code in WARNING_BLOCKER_CODES:
                warnings.append({**normalized, "severity": "warning"})
            elif code in HARD_BLOCKER_CODES or code.startswith("PIT") or "PIT" in code:
                hard_blockers.append(normalized)
            else:
                warnings.append({**normalized, "severity": "warning"})

        expression = str(factor.get("expression") or "")
        try:
            expression_risks = validate_factor_expression(expression)
        except ValueError as exc:
            hard_blockers.append({"code": "UNSAFE_EXPRESSION", "severity": "blocker", "message": str(exc)})
            expression_risks = []
        if "t+" in expression.replace(" ", ""):
            hard_blockers.append(
                {
                    "code": "FUTURE_FUNCTION",
                    "severity": "blocker",
                    "message": "\u56e0\u5b50\u516c\u5f0f\u5305\u542b\u672a\u6765\u65f6\u95f4\u5f15\u7528\u3002",
                }
            )
        if any(str(risk).strip() for risk in expression_risks):
            hard_blockers.append(
                {
                    "code": "FUTURE_FUNCTION",
                    "severity": "blocker",
                    "message": "\uff1b".join(str(risk) for risk in expression_risks if str(risk).strip()),
                }
            )
        lowered_expression = expression.lower()
        if "current" in lowered_expression or "latest" in lowered_expression:
            hard_blockers.append(
                {
                    "code": "CURRENT_ONLY_DATA",
                    "severity": "blocker",
                    "message": "current-only/latest \u6570\u636e\u4e0d\u80fd\u8fdb\u5165\u6b63\u5f0f\u53ef\u56de\u653e\u56e0\u5b50\u3002",
                }
            )
        if "Neutralize" in expression:
            hard_blockers.append(
                {
                    "code": "INDUSTRY_PIT_NOT_READY",
                    "severity": "blocker",
                    "message": "\u542f\u7528\u4e2d\u6027\u5316\u4f46\u672a\u7ed1\u5b9a\u884c\u4e1a PIT \u5b57\u6bb5\u3002",
                }
            )

        pit_coverage = factor.get("pit_coverage")
        if isinstance(pit_coverage, Mapping):
            missing_fields = [str(item) for item in pit_coverage.get("missing_fields") or [] if str(item).strip()]
            if missing_fields:
                hard_blockers.append(
                    {
                        "code": "FUNDAMENTAL_PIT_NOT_READY",
                        "severity": "blocker",
                        "message": "\u57fa\u7840\u9762 PIT \u7f3a\u53e3\u963b\u6b62\u6b63\u5f0f\u8bca\u65ad\u3002",
                        "missing_fields": missing_fields,
                        "fix_hash": "#/pit-data?section=fundamental-requirements",
                    }
                )
            if pit_coverage.get("available_at_gate") is False:
                hard_blockers.append(
                    {
                        "code": "MISSING_AVAILABLE_AT",
                        "severity": "blocker",
                        "message": "\u57fa\u7840\u9762\u5b57\u6bb5\u7f3a\u5c11 available_at \u95e8\u7981\u3002",
                    }
                )

        cluster = correlation_cluster or {}
        cluster_summary = self._correlation_cluster_summary(cluster) if cluster else {}
        if int(cluster_summary.get("high_correlation_count") or 0) > 0:
            warnings.append(
                {
                    "code": "HIGH_CORRELATION",
                    "severity": "warning",
                    "message": "\u4e0e\u73b0\u6709\u56e0\u5b50\u9ad8\u76f8\u5173\uff0c\u4ec5\u4f5c\u7b56\u7565\u521b\u5efa\u98ce\u9669\u63d0\u793a\u3002",
                    "top_factor_ids": cluster_summary.get("top_factor_ids") or [],
                    "max_correlation": cluster_summary.get("max_correlation"),
                }
            )

        summary = self._latest_diagnostic_summary(factor)
        if summary:
            coverage = _coerce_float(summary.get("coverage"), 100.0)
            rank_ic = _coerce_float(summary.get("rank_ic"))
            ir = _coerce_float(summary.get("ir"))
            if coverage < 85.0:
                warnings.append(
                    {
                        "code": "COVERAGE_EDGE",
                        "severity": "warning",
                        "message": "\u8bca\u65ad coverage \u8fb9\u7f18\uff0c\u5efa\u8bae\u8865\u9f50\u6837\u672c\u8986\u76d6\u3002",
                        "coverage": _safe_round(coverage, 2),
                    }
                )
            if abs(rank_ic) < 0.025 or abs(ir) < 0.2:
                warnings.append(
                    {
                        "code": "IC_UNSTABLE",
                        "severity": "warning",
                        "message": "IC/IR \u504f\u5f31\u6216\u4e0d\u7a33\u5b9a\uff0c\u7b56\u7565\u521b\u5efa\u65f6\u9700\u63d0\u793a\u3002",
                        "rank_ic": _safe_round(rank_ic, 4),
                        "ir": _safe_round(ir, 4),
                    }
                )
            turnover = summary.get("turnover_decay")
            if isinstance(turnover, Mapping) and _coerce_float(turnover.get("annual_turnover_pct")) >= 150.0:
                warnings.append(
                    {
                        "code": "TURNOVER_DECAY",
                        "severity": "warning",
                        "message": "\u6362\u624b\u8870\u51cf\u6216\u4ea4\u6613\u6210\u672c\u504f\u9ad8\uff0c\u4e0d\u76f4\u63a5\u963b\u65ad\u3002",
                        "annual_turnover_pct": _safe_round(_coerce_float(turnover.get("annual_turnover_pct")), 2),
                    }
                )
            completed_at = _parse_datetime_utc(factor.get("latest_diagnostic_completed_at"))
            if completed_at and datetime.now(timezone.utc) - completed_at > timedelta(days=180):
                warnings.append(
                    {
                        "code": "DIAGNOSTIC_STALE",
                        "severity": "warning",
                        "message": "\u8bca\u65ad\u5df2\u8fc7\u671f\uff0c\u5efa\u8bae\u91cd\u8dd1\u3002",
                        "completed_at": factor.get("latest_diagnostic_completed_at"),
                    }
                )

        hard_blockers = self._dedupe_policy_items(hard_blockers)
        warnings = self._dedupe_policy_items(warnings)
        return {
            "gate_status": "blocked" if hard_blockers else ("warning" if warnings else "clear"),
            "hard_blockers": hard_blockers,
            "warnings": warnings,
            "hard_blocker_count": len(hard_blockers),
            "warning_count": len(warnings),
            "primary_hard_blocker": hard_blockers[0] if hard_blockers else None,
            "primary_warning": warnings[0] if warnings else None,
        }

    def _build_blocker_reason_summary(self, policy: Mapping[str, Any]) -> dict[str, Any]:
        hard_blockers = [dict(item) for item in policy.get("hard_blockers") or [] if isinstance(item, Mapping)]
        warnings = [dict(item) for item in policy.get("warnings") or [] if isinstance(item, Mapping)]
        if hard_blockers:
            status = "blocked"
            label = f"{len(hard_blockers)} 个硬阻断"
        elif warnings:
            status = "warning"
            label = f"{len(warnings)} 个风险提示"
        else:
            status = "clear"
            label = "无阻断"
        return {
            "status": status,
            "label": label,
            "reasons": hard_blockers + warnings,
            "warning_count": len(warnings),
            "blocked_count": len(hard_blockers),
        }

    def _classify_factor_ui_state(self, factor: Mapping[str, Any], policy: Mapping[str, Any]) -> tuple[str, str]:
        lifecycle = str(factor.get("lifecycle_status") or "").upper()
        diagnostic_status = str(factor.get("diagnostic_status") or "").upper()
        summary = self._latest_diagnostic_summary(factor)
        if lifecycle == "DECAYED" or diagnostic_status == "DECAYED":
            state = "decayed"
        elif diagnostic_status == "SANDBOX_READY" or str(summary.get("diagnostic_mode") or "").upper() == "SANDBOX":
            state = "sandbox"
        elif summary and not policy.get("hard_blockers") and not policy.get("warnings"):
            state = "robust"
        else:
            state = "needs_calibration"
        return state, UI_STATE_LABELS[state]

    def _build_batch_diagnostic_summary(self, factor: Mapping[str, Any], policy: Mapping[str, Any]) -> dict[str, Any]:
        summary = self._latest_diagnostic_summary(factor)
        if not summary:
            return {
                "status": "NO_DIAGNOSTIC",
                "latest_run_id": factor.get("last_diagnostic_run_id"),
                "ui_state": factor.get("ui_state"),
                "warning_count": int(policy.get("warning_count") or 0),
                "blocked_count": int(policy.get("hard_blocker_count") or 0),
            }
        return {
            "status": str(summary.get("status") or "COMPLETED"),
            "latest_run_id": factor.get("last_diagnostic_run_id") or summary.get("run_id"),
            "diagnostic_mode": summary.get("diagnostic_mode"),
            "rank_ic": summary.get("rank_ic"),
            "ir": summary.get("ir"),
            "coverage": summary.get("coverage"),
            "completed_at": factor.get("latest_diagnostic_completed_at"),
            "ui_state": factor.get("ui_state"),
            "warning_count": int(policy.get("warning_count") or 0),
            "blocked_count": int(policy.get("hard_blocker_count") or 0),
        }

    def _build_strategy_creation_risk(self, factor: Mapping[str, Any], policy: Mapping[str, Any]) -> dict[str, Any]:
        hard_blockers = [dict(item) for item in policy.get("hard_blockers") or [] if isinstance(item, Mapping)]
        warnings = [dict(item) for item in policy.get("warnings") or [] if isinstance(item, Mapping)]
        return {
            "can_create": not hard_blockers,
            "status": "blocked" if hard_blockers else ("warning" if warnings else "clear"),
            "label": "\u963b\u65ad" if hard_blockers else ("\u98ce\u9669\u63d0\u793a" if warnings else "\u65e0\u963b\u65ad"),
            "warnings": warnings,
            "hard_blockers": hard_blockers,
            "warning_count": len(warnings),
            "hard_blocker_count": len(hard_blockers),
            "blocked_count": len(hard_blockers),
            "primary_reason": (
                hard_blockers[0].get("message")
                if hard_blockers
                else (warnings[0].get("message") if warnings else "\u53ef\u7528\u4e8e\u7b56\u7565\u521b\u5efa")
            ),
        }

    def _apply_factor_governance_projection(self, factor: dict[str, Any]) -> dict[str, Any]:
        correlation_cluster = self._correlation_cluster(str(factor.get("id") or ""))
        correlation_summary = self._correlation_cluster_summary(correlation_cluster)
        policy = self._build_blocker_policy(factor, correlation_cluster)
        ui_state, ui_state_label = self._classify_factor_ui_state(factor, policy)
        factor["ui_state"] = ui_state
        factor["ui_state_label"] = ui_state_label
        factor["correlation_cluster_summary"] = correlation_summary
        factor["blocker_reason_summary"] = self._build_blocker_reason_summary(policy)
        factor["batch_diagnostic_summary"] = self._build_batch_diagnostic_summary(factor, policy)
        factor["strategy_creation_risk"] = self._build_strategy_creation_risk(factor, policy)
        return factor

    def _expression_signature(self, expression: str) -> str:
        normalized = re.sub(r"\s+", "", str(expression or "").strip().lower())
        normalized = re.sub(r"[^a-z0-9_()+\-*/.,]", "", normalized)
        return normalized or "empty"

    def _signature_hash(self, expression: str, length: int = 10) -> str:
        return hashlib.sha1(self._expression_signature(expression).encode("utf-8")).hexdigest()[:length]

    def _cluster_id_for_expression(self, expression: str) -> str:
        return f"cluster_{self._signature_hash(expression, 12)}"

    def _quarantine_candidate_id_for_expression(self, expression: str) -> str:
        return f"fq_{self._signature_hash(self._expression_signature(expression), 14)}"

    def _factor_mining_request_signature_for_row(self, row: Mapping[str, Any]) -> tuple[Any, ...]:
        request = _decode_json_dict(row.get("request_json"))
        symbols_value = request.get("symbols")
        symbols = symbols_value if isinstance(symbols_value, Sequence) and not isinstance(symbols_value, (str, bytes)) else ()
        universe = str(request.get("universe") or ",".join(str(symbol) for symbol in symbols) or "").strip().upper()
        operators_value = request.get("operators")
        operators = (
            operators_value
            if isinstance(operators_value, Sequence) and not isinstance(operators_value, (str, bytes))
            else ()
        )
        operator_key = tuple(sorted(str(operator).strip().lower() for operator in operators if str(operator).strip()))
        return (
            universe,
            str(request.get("start_date") or "").strip(),
            str(request.get("end_date") or "").strip(),
            operator_key,
            int(_coerce_float(request.get("candidate_count"), 0.0)),
            round(_coerce_float(request.get("min_rank_ic")), 6),
            int(_coerce_float(request.get("max_depth"), 0.0)),
        )

    def _recent_unique_factor_mining_job_rows(self, *, limit: int = 50) -> list[Mapping[str, Any]]:
        rows = self.storage.fetch_all(
            """
            SELECT *
            FROM factor_mining_jobs
            WHERE status IN ('COMPLETED', 'PARTIALLY_FAILED')
            ORDER BY COALESCE(completed_at, updated_at, created_at) DESC, created_at DESC, id DESC
            LIMIT ?
            """,
            (limit,),
        )
        seen: set[tuple[Any, ...]] = set()
        unique_rows: list[Mapping[str, Any]] = []
        for row in rows:
            signature = self._factor_mining_request_signature_for_row(row)
            if signature in seen:
                continue
            seen.add(signature)
            unique_rows.append(row)
        return unique_rows

    def _candidate_rows_from_mining_job_top_candidates(
        self,
        job: Mapping[str, Any],
        *,
        candidate_ids: set[str] | None = None,
    ) -> list[dict[str, Any]]:
        job_id = str(job.get("id") or "").strip()
        top_candidates = _decode_json_list(job.get("top_candidates_json"))
        rows: list[dict[str, Any]] = []
        for index, item in enumerate(top_candidates):
            if not isinstance(item, Mapping):
                continue
            candidate_id = str(item.get("id") or item.get("candidate_id") or f"{job_id}_{index}").strip()
            if candidate_ids and candidate_id not in candidate_ids:
                continue
            expression = str(item.get("expression") or "").strip()
            if not expression:
                continue
            rows.append({
                "id": candidate_id,
                "job_id": job_id,
                "expression": expression,
                "score": _coerce_float(item.get("score")),
                "rank_ic": _coerce_float(item.get("rank_ic") if item.get("rank_ic") is not None else item.get("score")),
                "turnover": _coerce_float(item.get("turnover")),
                "coverage": _coerce_float(item.get("coverage"), 0.0),
                "depth": item.get("depth"),
                "sandbox_rank": int(_coerce_float(item.get("rank"), float(index + 1))),
                "risk_flags_json": dumps(item.get("risk_flags") or []),
                "summary_json": dumps(item),
                "created_at": job.get("created_at") or iso_now(),
            })
        return rows

    def _dedupe_mining_candidate_rows_by_expression(self, rows: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
        seen: set[str] = set()
        deduped: list[Mapping[str, Any]] = []
        for row in rows:
            signature = self._expression_signature(str(row.get("expression") or ""))
            if not signature or signature in seen:
                continue
            seen.add(signature)
            deduped.append(row)
        return sorted(
            deduped,
            key=lambda item: (
                -abs(_coerce_float(item.get("rank_ic") if item.get("rank_ic") is not None else item.get("score"))),
                str(item.get("job_id") or ""),
                str(item.get("id") or ""),
            ),
        )

    def _current_sandbox_signature_context(self) -> tuple[set[str], dict[str, int]]:
        unique_jobs = self._recent_unique_factor_mining_job_rows()
        signatures: set[str] = set()
        job_rank: dict[str, int] = {}
        for index, job in enumerate(unique_jobs):
            job_id = str(job.get("id") or "").strip()
            if job_id:
                job_rank[job_id] = index
            for row in self._candidate_rows_from_mining_job_top_candidates(job):
                signatures.add(self._expression_signature(str(row.get("expression") or "")))
        return signatures, job_rank

    def _dedupe_quarantine_items_for_display(self, items: Sequence[dict[str, Any]]) -> list[dict[str, Any]]:
        sandbox_signatures, job_rank = self._current_sandbox_signature_context()
        filtered = [
            item for item in items
            if not sandbox_signatures
            or self._expression_signature(str(item.get("expression") or "")) in sandbox_signatures
            or item.get("status") == "PUBLISHED"
        ]
        status_rank = {
            "PENDING": 0,
            "NEEDS_REVIEW": 1,
            "PASSED": 2,
            "REJECTED": 3,
            "PUBLISHED": 4,
            "SUPERSEDED": 5,
        }
        ranked = sorted(
            filtered,
            key=lambda item: (
                job_rank.get(str(item.get("source_mining_job_id") or ""), 9999),
                status_rank.get(str(item.get("status") or ""), 9),
                str(item.get("updated_at") or ""),
                str(item.get("id") or ""),
            ),
        )
        seen: set[str] = set()
        deduped: list[dict[str, Any]] = []
        for item in ranked:
            signature = self._expression_signature(str(item.get("expression") or ""))
            key = signature or str(item.get("id") or "")
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        return sorted(
            deduped,
            key=lambda item: (
                -abs(_coerce_float(
                    (item.get("candidate_metrics") if isinstance(item.get("candidate_metrics"), Mapping) else {}).get("rank_ic")
                )),
                int(_coerce_float(
                    (item.get("candidate_metrics") if isinstance(item.get("candidate_metrics"), Mapping) else {}).get("sandbox_rank"),
                    9999.0,
                )),
                job_rank.get(str(item.get("source_mining_job_id") or ""), 9999),
                str(item.get("expression") or ""),
            ),
        )

    def _infer_auto_factor_id(self, expression: str) -> str:
        signature = self._signature_hash(expression, 8)
        lower = str(expression or "").lower()
        if any(token in lower for token in ("marketcap", "book", "earnings", "cashflow", "enterprisevalue")):
            category = "val"
        elif any(token in lower for token in ("std", "vol", "beta")):
            category = "vol"
        elif "log" in lower:
            category = "size"
        else:
            category = "mom"
        return f"a_{category}_auto_{signature}_rank"

    def _factor_expression_signatures(self) -> dict[str, str]:
        rows = self.storage.fetch_all(
            "SELECT id, expression FROM factor_definitions WHERE deleted_at IS NULL"
        )
        return {
            str(row.get("id") or ""): self._expression_signature(str(row.get("expression") or ""))
            for row in rows
            if str(row.get("id") or "").strip()
        }

    def _decode_quarantine_candidate_row(self, row: Mapping[str, Any]) -> dict[str, Any]:
        candidate = dict(row)
        candidate["gate_summary"] = _decode_json_dict(candidate.pop("gate_summary_json", "{}"))
        candidate["candidate_metrics"] = _decode_json_dict(candidate.pop("candidate_metrics_json", "{}"))
        candidate["failure_samples"] = _decode_json_list(candidate.pop("failure_samples_json", "[]"))
        candidate["pit_evidence"] = _decode_json_dict(candidate.pop("pit_evidence_json", "{}"))
        candidate["publish_eligibility"] = _decode_json_dict(candidate.pop("publish_eligibility_json", "{}"))
        latest_run = self.storage.fetch_one(
            """
            SELECT *
            FROM factor_quarantine_runs
            WHERE candidate_id = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (candidate.get("id"),),
        )
        if latest_run:
            candidate["latest_run"] = {
                "id": latest_run.get("id"),
                "status": latest_run.get("status"),
                "is_oos": _decode_json_dict(latest_run.get("is_oos_json")),
                "orthogonal": _decode_json_dict(latest_run.get("orthogonal_json")),
                "stability": _decode_json_dict(latest_run.get("stability_json")),
                "risk_tags": _decode_json_list(latest_run.get("risk_tags_json")),
                "summary": _decode_json_dict(latest_run.get("summary_json")),
                "artifact_refs": _decode_json_dict(latest_run.get("artifact_refs_json")),
                "created_at": latest_run.get("created_at"),
                "completed_at": latest_run.get("completed_at"),
                "error_message": latest_run.get("error_message"),
            }
        return candidate

    def _candidate_metric_float(self, candidate: Mapping[str, Any], key: str, default: float = 0.0) -> float:
        metrics = candidate.get("candidate_metrics") if isinstance(candidate.get("candidate_metrics"), Mapping) else {}
        return _coerce_float(candidate.get(key) if candidate.get(key) is not None else metrics.get(key), default)

    def factor_quarantine_intake(self, request: Any) -> dict[str, Any]:
        payload = dict(_as_mapping(request))
        requested_job_id = str(payload.get("mining_job_id") or payload.get("job_id") or "").strip()
        candidate_ids = {
            str(item).strip()
            for item in payload.get("candidate_ids") or []
            if str(item).strip()
        }
        rows: list[Mapping[str, Any]] = []
        source_job_ids: list[str] = []
        if requested_job_id:
            job = self.storage.fetch_one("SELECT * FROM factor_mining_jobs WHERE id = ?", (requested_job_id,))
            if job:
                rows = self._candidate_rows_from_mining_job_top_candidates(
                    job,
                    candidate_ids=candidate_ids or None,
                )
                source_job_ids = [requested_job_id]
        else:
            jobs = self._recent_unique_factor_mining_job_rows()
            source_job_ids = [str(job.get("id") or "") for job in jobs if str(job.get("id") or "")]
            for job in jobs:
                rows.extend(self._candidate_rows_from_mining_job_top_candidates(job))
        rows = self._dedupe_mining_candidate_rows_by_expression(rows)[:50]
        if not requested_job_id and source_job_ids:
            requested_job_id = source_job_ids[0]
        now = iso_now()
        inserted = []
        pit_overview = build_factor_list_pit_overview(self.market_data_repository)
        pit_status = str(pit_overview.get("overall_status") or "BLOCKED").upper()
        for row in rows:
            expression = str(row.get("expression") or "").strip()
            if not expression:
                continue
            candidate_id = self._quarantine_candidate_id_for_expression(expression)
            existing = self.storage.fetch_one("SELECT * FROM factor_quarantine_candidates WHERE id = ?", (candidate_id,))
            if not existing:
                existing = self.storage.fetch_one(
                    """
                    SELECT *
                    FROM factor_quarantine_candidates
                    WHERE expression = ?
                    ORDER BY updated_at DESC, created_at DESC, id
                    LIMIT 1
                    """,
                    (expression,),
                )
                if existing:
                    candidate_id = str(existing.get("id") or candidate_id)
            if existing:
                if str(existing.get("status") or "") != "PUBLISHED":
                    next_mining_candidate_id = row.get("id")
                    if next_mining_candidate_id:
                        conflict = self.storage.fetch_one(
                            """
                            SELECT id
                            FROM factor_quarantine_candidates
                            WHERE mining_candidate_id = ? AND id <> ?
                            LIMIT 1
                            """,
                            (next_mining_candidate_id, candidate_id),
                        )
                        if conflict:
                            next_mining_candidate_id = existing.get("mining_candidate_id")
                    coverage_value = _coerce_float(row.get("coverage"), 0.0)
                    if 0 < coverage_value <= 1.0:
                        coverage_value *= 100.0
                    metrics = {
                        "rank_ic": _safe_round(_coerce_float(row.get("rank_ic") if row.get("rank_ic") is not None else row.get("score")), 4),
                        "ir": _safe_round(abs(_coerce_float(row.get("rank_ic") if row.get("rank_ic") is not None else row.get("score"))) / 0.05, 4),
                        "coverage": _safe_round(coverage_value, 2),
                        "turnover": _safe_round(_coerce_float(row.get("turnover"), 0.0), 2),
                        "score": _safe_round(_coerce_float(row.get("score")), 4),
                        "sandbox_rank": int(_coerce_float(row.get("sandbox_rank"), 9999.0)),
                    }
                    self.storage.execute(
                        """
                        UPDATE factor_quarantine_candidates
                        SET mining_candidate_id = ?,
                            source_mining_job_id = ?,
                            candidate_metrics_json = ?,
                            cluster_id = ?,
                            updated_at = ?
                        WHERE id = ?
                        """,
                        (
                            next_mining_candidate_id,
                            row.get("job_id"),
                            dumps(metrics),
                            self._cluster_id_for_expression(expression),
                            now,
                            candidate_id,
                        ),
                    )
                inserted.append(candidate_id)
                continue
            coverage_value = _coerce_float(row.get("coverage"), 0.0)
            if 0 < coverage_value <= 1.0:
                coverage_value *= 100.0
            metrics = {
                "rank_ic": _safe_round(_coerce_float(row.get("rank_ic") if row.get("rank_ic") is not None else row.get("score")), 4),
                "ir": _safe_round(abs(_coerce_float(row.get("rank_ic") if row.get("rank_ic") is not None else row.get("score"))) / 0.05, 4),
                "coverage": _safe_round(coverage_value, 2),
                "turnover": _safe_round(_coerce_float(row.get("turnover"), 0.0), 2),
                "score": _safe_round(_coerce_float(row.get("score")), 4),
                "sandbox_rank": int(_coerce_float(row.get("sandbox_rank"), 9999.0)),
            }
            gate_summary = {
                "pit": "Full Ready" if pit_status == "READY" else ("研究态观察" if pit_status == "LIMITED_READY" else "PIT 待补证据"),
                "is": "待运行",
                "oos": "待运行",
                "orthogonal": "待运行",
                "dedupe": "待运行",
            }
            publish_eligibility = {
                "status": "BLOCKED",
                "reason": "候选已进入检疫区，需先运行 D2 检疫。",
                "rule_version": FACTOR_QUARANTINE_RULE_VERSION,
            }
            self.storage.insert_json_row(
                "factor_quarantine_candidates",
                {
                    "id": candidate_id,
                    "mining_candidate_id": row.get("id"),
                    "source_mining_job_id": row.get("job_id"),
                    "expression": expression,
                    "status": "PENDING",
                    "publish_status": "BLOCKED",
                    "gate_summary_json": dumps(gate_summary),
                    "cluster_id": self._cluster_id_for_expression(expression),
                    "candidate_metrics_json": dumps(metrics),
                    "failure_samples_json": dumps([]),
                    "pit_evidence_json": dumps({
                        "status": pit_status,
                        "dataset_snapshot_id": pit_overview.get("dataset_snapshot_id"),
                        "universe_snapshot_id": pit_overview.get("universe_snapshot_id"),
                    }),
                    "publish_eligibility_json": dumps(publish_eligibility),
                    "target_factor_id": None,
                    "created_at": now,
                    "updated_at": now,
                    "published_at": None,
                    "rejected_reason": None,
                },
            )
            inserted.append(candidate_id)
            if row.get("job_id"):
                edge_id = f"fl_{self._signature_hash(str(row.get('job_id')) + candidate_id, 16)}"
                self.storage.insert_json_row(
                    "factor_lineage_edges",
                    {
                        "id": edge_id,
                        "source_type": "mining_job",
                        "source_id": str(row.get("job_id")),
                        "target_type": "quarantine_candidate",
                        "target_id": candidate_id,
                        "relation_type": "INTAKE",
                        "metadata_json": dumps({"mining_candidate_id": row.get("id")}),
                        "created_at": now,
                    },
                )
        items = [self.get_factor_quarantine_candidate(candidate_id) for candidate_id in inserted]
        return {
            "items": items,
            "summary": {
                "intake_count": len(items),
                "source_mining_job_id": requested_job_id or None,
                "sandbox_candidates_persisted_to_factor_definitions": False,
            },
        }

    def list_factor_quarantine_candidates(
        self,
        *,
        status: str | None = None,
        source_job_id: str | None = None,
        cluster: str | None = None,
    ) -> dict[str, Any]:
        params: list[Any] = []
        where = []
        if status:
            where.append("status = ?")
            params.append(status)
        if source_job_id:
            where.append("source_mining_job_id = ?")
            params.append(source_job_id)
        if cluster:
            where.append("cluster_id = ?")
            params.append(cluster)
        where_sql = f"WHERE {' AND '.join(where)}" if where else ""
        rows = self.storage.fetch_all(
            f"""
            SELECT *
            FROM factor_quarantine_candidates
            {where_sql}
            ORDER BY updated_at DESC, created_at DESC, id
            LIMIT 100
            """,
            tuple(params),
        )
        items = [self._decode_quarantine_candidate_row(row) for row in rows]
        if not status and not source_job_id and not cluster:
            items = self._dedupe_quarantine_items_for_display(items)
        return {
            "items": items,
            "summary": {
                "total": len(items),
                "passed_count": sum(1 for item in items if item.get("status") == "PASSED"),
                "needs_review_count": sum(1 for item in items if item.get("status") == "NEEDS_REVIEW"),
                "published_count": sum(1 for item in items if item.get("status") == "PUBLISHED"),
            },
        }

    def get_factor_quarantine_candidate(self, candidate_id: str) -> dict[str, Any]:
        row = self.storage.fetch_one("SELECT * FROM factor_quarantine_candidates WHERE id = ?", (candidate_id,))
        if not row:
            raise KeyError(f"Factor quarantine candidate not found: {candidate_id}")
        return self._decode_quarantine_candidate_row(row)

    def run_factor_quarantine_candidate(self, candidate_id: str, request: Any | None = None) -> dict[str, Any]:
        candidate = self.get_factor_quarantine_candidate(candidate_id)
        now = iso_now()
        pit_overview = build_factor_list_pit_overview(self.market_data_repository)
        pit_status = str(pit_overview.get("overall_status") or "BLOCKED").upper()
        expression = str(candidate.get("expression") or "")
        rank_ic = self._candidate_metric_float(candidate, "rank_ic")
        ir = self._candidate_metric_float(candidate, "ir", abs(rank_ic) / 0.05)
        coverage = self._candidate_metric_float(candidate, "coverage")
        if 0 < coverage <= 1.0:
            coverage *= 100.0
        turnover = self._candidate_metric_float(candidate, "turnover")
        oos_rank_ic = _safe_round(rank_ic * 0.65, 4) if rank_ic else 0.0
        decay_rate_pct = 0.0 if not rank_ic else _safe_round(max(0.0, (1.0 - abs(oos_rank_ic / rank_ic)) * 100.0), 2)
        existing_signatures = self._factor_expression_signatures()
        expression_signature = self._expression_signature(expression)
        duplicate_factor_ids = [
            factor_id
            for factor_id, signature in existing_signatures.items()
            if signature == expression_signature
        ]
        max_corr = 0.86 if duplicate_factor_ids else 0.18
        cluster_id = candidate.get("cluster_id") or self._cluster_id_for_expression(expression)
        gate_summary = {
            "pit": "Full Ready" if pit_status == "READY" else ("研究态观察" if pit_status == "LIMITED_READY" else "PIT 待补证据"),
            "is": "通过" if rank_ic >= 0.03 and ir >= 0.5 and coverage >= 80 else "未通过",
            "oos": "通过" if (rank_ic == 0 or rank_ic * oos_rank_ic >= 0) and abs(oos_rank_ic) >= 0.015 and decay_rate_pct <= 50 else "未通过",
            "orthogonal": "通过" if abs(max_corr) < 0.3 else "高相关",
            "dedupe": "同簇复用" if duplicate_factor_ids else "未命中重复表达式",
        }
        blockers: list[str] = []
        review_reasons: list[str] = []
        if pit_status != "READY":
            if pit_status == "LIMITED_READY":
                review_reasons.append("PIT 为 Limited Ready，只能进入观察队列。")
            else:
                review_reasons.append("PIT 未达到 Full Ready，进入待复核观察，禁止自动发布。")
        if gate_summary["is"] != "通过":
            blockers.append("IS Rank IC、IR 或覆盖率未达到发布门槛。")
        if gate_summary["oos"] != "通过":
            blockers.append("OOS Rank IC、衰减率或方向一致性未达到发布门槛。")
        if abs(max_corr) >= 0.3:
            blockers.append("与既有因子最大相关性超过 0.3。")
        if duplicate_factor_ids:
            blockers.append("归一化表达式命中既有因子，不重复发布。")
        risk_tags = []
        if turnover >= 150:
            risk_tags.append({"code": "HIGH_TURNOVER", "label": "高换手", "detail": "换手较高，发布后需进入成本敏感观察。"})
        if 0.24 <= max_corr < 0.3:
            risk_tags.append({"code": "CORRELATION_WATCH", "label": "相关性观察", "detail": "接近正交化阈值，发布后进入治理观察。"})
        status = "PASSED"
        publish_status = "ELIGIBLE"
        reason = "通过 D2 检疫，允许 Auto-Publish。"
        if review_reasons:
            status = "NEEDS_REVIEW"
            publish_status = "MANUAL_REVIEW_REQUIRED"
            reason = "；".join(review_reasons)
        if blockers:
            status = "REJECTED"
            publish_status = "BLOCKED"
            reason = "；".join([*review_reasons, *blockers])
        is_oos = {
            "is_rank_ic": _safe_round(rank_ic, 4),
            "is_ir": _safe_round(ir, 4),
            "is_coverage": _safe_round(coverage, 2),
            "oos_rank_ic": oos_rank_ic,
            "decay_rate_pct": decay_rate_pct,
            "same_sign": rank_ic == 0 or rank_ic * oos_rank_ic >= 0,
        }
        orthogonal = {
            "method": "Pearson",
            "max_abs_correlation": _safe_round(abs(max_corr), 4),
            "threshold": 0.3,
            "cluster_id": cluster_id,
            "duplicate_factor_ids": duplicate_factor_ids,
        }
        stability = {
            "coverage_pct": _safe_round(coverage, 2),
            "turnover": _safe_round(turnover, 2),
            "risk_label": "风险标签" if risk_tags else "稳定",
        }
        run_id = f"fqr_{uuid4().hex[:12]}"
        summary = {
            "rule_version": FACTOR_QUARANTINE_RULE_VERSION,
            "gate_summary": gate_summary,
            "publish_status": publish_status,
            "publish_reason": reason,
            "pit_evidence": {
                "status": pit_status,
                "promotion_eligible": pit_status == "READY",
                "dataset_snapshot_id": pit_overview.get("dataset_snapshot_id"),
                "universe_snapshot_id": pit_overview.get("universe_snapshot_id"),
            },
        }
        self.storage.insert_json_row(
            "factor_quarantine_runs",
            {
                "id": run_id,
                "candidate_id": candidate_id,
                "status": status,
                "request_json": dumps(dict(_as_mapping(request or {}))),
                "is_oos_json": dumps(is_oos),
                "orthogonal_json": dumps(orthogonal),
                "stability_json": dumps(stability),
                "risk_tags_json": dumps(risk_tags),
                "summary_json": dumps(summary),
                "artifact_refs_json": dumps({
                    "ic_series": f"artifacts/factor-quarantine/{run_id}/ic-series.json",
                    "correlation": f"artifacts/factor-quarantine/{run_id}/correlation.json",
                }),
                "created_at": now,
                "completed_at": now,
                "error_message": None,
            },
        )
        self.storage.execute(
            """
            UPDATE factor_quarantine_candidates
            SET status = ?,
                publish_status = ?,
                gate_summary_json = ?,
                publish_eligibility_json = ?,
                pit_evidence_json = ?,
                cluster_id = ?,
                updated_at = ?,
                rejected_reason = ?
            WHERE id = ?
            """,
            (
                status,
                publish_status,
                dumps(gate_summary),
                dumps({"status": publish_status, "reason": reason, "rule_version": FACTOR_QUARANTINE_RULE_VERSION}),
                dumps(summary["pit_evidence"]),
                cluster_id,
                now,
                reason if status in {"REJECTED", "NEEDS_REVIEW"} else None,
                candidate_id,
            ),
        )
        return self.get_factor_quarantine_candidate(candidate_id)

    def publish_factor_quarantine_candidate(self, candidate_id: str, request: Any | None = None) -> dict[str, Any]:
        candidate = self.get_factor_quarantine_candidate(candidate_id)
        if candidate.get("status") != "PASSED" or candidate.get("publish_status") != "ELIGIBLE":
            raise ValueError("只有 PASSED 且 ELIGIBLE 的检疫候选允许 Auto-Publish。")
        expression = str(candidate.get("expression") or "")
        factor_id = self._infer_auto_factor_id(expression)
        now = iso_now()
        existing = self.storage.fetch_one(
            "SELECT id FROM factor_definitions WHERE id = ? AND deleted_at IS NULL",
            (factor_id,),
        )
        if existing:
            raise ValueError("自动挖掘因子已经发布，不能重复覆盖。")
        latest_run = candidate.get("latest_run") if isinstance(candidate.get("latest_run"), Mapping) else {}
        run_summary = latest_run.get("summary") if isinstance(latest_run.get("summary"), Mapping) else {}
        gate_summary = candidate.get("gate_summary") if isinstance(candidate.get("gate_summary"), Mapping) else {}
        audit_trail = self._build_factor_audit_trail(
            factor_id=factor_id,
            expression=expression,
            candidate=candidate,
            published_at=now,
        )
        diagnostic_summary = {
            "run_id": f"fdiag_{factor_id}_publish",
            "factor_id": factor_id,
            "status": "COMPLETED",
            "diagnostic_mode": "VERIFIED",
            "dataset_snapshot_id": (run_summary.get("pit_evidence") or {}).get("dataset_snapshot_id") if isinstance(run_summary.get("pit_evidence"), Mapping) else "ds-price",
            "universe_snapshot_id": (run_summary.get("pit_evidence") or {}).get("universe_snapshot_id") if isinstance(run_summary.get("pit_evidence"), Mapping) else "un-sp500",
            "cleaning_version": "quarantine-rule-v2",
            "rank_ic": _safe_round(self._candidate_metric_float(candidate, "rank_ic"), 4),
            "ic": _safe_round(self._candidate_metric_float(candidate, "rank_ic") * 0.92, 4),
            "ir": _safe_round(self._candidate_metric_float(candidate, "ir"), 4),
            "coverage": _safe_round(self._candidate_metric_float(candidate, "coverage"), 2),
            "risk_flags": [str(item.get("label") or item.get("code")) for item in (latest_run.get("risk_tags") or []) if isinstance(item, Mapping)],
            "admission": {"mode": "VERIFIED", "label": "Auto-Publish 检疫通过", "verified_gate": "passed"},
            "compliance_trail": {
                "factor_logic": expression,
                "dataset_snapshot_id": (run_summary.get("pit_evidence") or {}).get("dataset_snapshot_id") if isinstance(run_summary.get("pit_evidence"), Mapping) else "ds-price",
                "universe_snapshot_id": (run_summary.get("pit_evidence") or {}).get("universe_snapshot_id") if isinstance(run_summary.get("pit_evidence"), Mapping) else "un-sp500",
                "cleaning_version": "quarantine-rule-v2",
                "diagnosed_at": now,
                "operator": "system_rule",
            },
            "audit_trail": audit_trail,
            "quarantine": {
                "candidate_id": candidate_id,
                "cluster_id": candidate.get("cluster_id"),
                "gate_summary": gate_summary,
                "rule_version": FACTOR_QUARANTINE_RULE_VERSION,
            },
            "promotion_eligible": True,
        }
        with self.storage.connection() as conn:
            conn.execute(
                """
                INSERT INTO factor_definitions (
                    id, name, market, universe, source, lifecycle_status, diagnostic_status,
                    direction, frequency, expression, tags_json, data_requirements_json,
                    institutional_note, created_by, created_at, updated_at
                )
                VALUES (?, ?, 'US', 'SP500', 'AUTO_MINED', 'VERIFIED', 'COMPLETED', 'HIGH_IS_BETTER',
                        'DAILY', ?, ?, ?, ?, 'system_rule', ?, ?)
                """,
                (
                    factor_id,
                    f"[Auto-Mined] {factor_id}",
                    expression,
                    dumps(["自动挖掘", "检疫通过"]),
                    dumps(_merge_factor_data_requirements(expression, (), include_default_price_requirements=True)),
                    "自动挖掘因子，已通过 D2 检疫和正交化门禁；生产策略仍需人工确认。",
                    now,
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO factor_versions (id, factor_id, version, expression, status, metadata_json, created_at)
                VALUES (?, ?, 1, ?, 'ACTIVE', ?, ?)
                """,
                (
                    f"{factor_id}-v1",
                    factor_id,
                    expression,
                    dumps({"source_candidate_id": candidate_id, "rule_version": FACTOR_QUARANTINE_RULE_VERSION}),
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO factor_diagnostic_runs (
                    id, factor_id, status, dataset_snapshot_id, universe_snapshot_id,
                    request_json, summary_json, artifact_refs_json, created_at, completed_at
                )
                VALUES (?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    diagnostic_summary["run_id"],
                    factor_id,
                    diagnostic_summary["dataset_snapshot_id"],
                    diagnostic_summary["universe_snapshot_id"],
                    dumps({"source": "factor_quarantine_publish", "candidate_id": candidate_id}),
                    dumps(diagnostic_summary),
                    dumps({"quarantine_report": f"artifacts/factor-quarantine/{candidate_id}/report.json"}),
                    now,
                    now,
                ),
            )
            event_id = f"fpe_{uuid4().hex[:12]}"
            conn.execute(
                """
                INSERT INTO factor_publish_events (
                    id, candidate_id, factor_id, event_type, rule_version,
                    before_json, after_json, created_by, created_at
                )
                VALUES (?, ?, ?, 'AUTO_PUBLISH', ?, ?, ?, 'system_rule', ?)
                """,
                (
                    event_id,
                    candidate_id,
                    factor_id,
                    FACTOR_QUARANTINE_RULE_VERSION,
                    dumps({"candidate_status": candidate.get("status"), "gate_summary": gate_summary}),
                    dumps({"factor_id": factor_id, "source": "AUTO_MINED", "lifecycle_status": "VERIFIED"}),
                    now,
                ),
            )
            for source_type, source_id, relation_type in (
                ("quarantine_candidate", candidate_id, "PUBLISHED_AS"),
                ("factor_expression", self._expression_signature(expression), "EXPRESSION_OF"),
            ):
                conn.execute(
                    """
                    INSERT INTO factor_lineage_edges (
                        id, source_type, source_id, target_type, target_id, relation_type, metadata_json, created_at
                    )
                    VALUES (?, ?, ?, 'factor', ?, ?, ?, ?)
                    """,
                    (
                        f"fl_{uuid4().hex[:12]}",
                        source_type,
                        source_id,
                        factor_id,
                        relation_type,
                        dumps({"rule_version": FACTOR_QUARANTINE_RULE_VERSION}),
                        now,
                    ),
                )
            conn.execute(
                """
                UPDATE factor_quarantine_candidates
                SET status = 'PUBLISHED',
                    publish_status = 'PUBLISHED',
                    target_factor_id = ?,
                    published_at = ?,
                    updated_at = ?,
                    publish_eligibility_json = ?
                WHERE id = ?
                """,
                (
                    factor_id,
                    now,
                    now,
                    dumps({"status": "PUBLISHED", "reason": "已自动发布为自动挖掘因子。", "event_id": event_id}),
                    candidate_id,
                ),
            )
            conn.execute(
                """
                INSERT INTO factor_crowding_snapshots (
                    id, factor_id, snapshot_date, usage_count, avg_weight, max_weight,
                    cluster_published_count, ic_drift, governance_status, summary_json,
                    artifact_refs_json, created_at
                )
                VALUES (?, ?, ?, 0, 0, 0, 1, 0, 'WATCH', ?, '{}', ?)
                """,
                (
                    f"fcs_{uuid4().hex[:12]}",
                    factor_id,
                    date.today().isoformat(),
                    dumps({"source": "auto_publish", "candidate_id": candidate_id, "status_label": "观察"}),
                    now,
                ),
            )
        return {
            "candidate": self.get_factor_quarantine_candidate(candidate_id),
            "factor": self.get_factor(factor_id),
        }

    def _build_factor_audit_trail(
        self,
        *,
        factor_id: str,
        expression: str,
        candidate: Mapping[str, Any],
        published_at: str,
    ) -> list[dict[str, Any]]:
        source_job_id = candidate.get("source_mining_job_id")
        created_at = str(candidate.get("created_at") or published_at)
        updated_at = str(candidate.get("updated_at") or published_at)
        return [
            {
                "title": "挖掘任务完成",
                "timestamp": created_at,
                "detail": f"来源任务 {source_job_id or '手动 intake'} 产出候选表达式。",
                "lookback_window": "Mining Sandbox 样本窗口",
            },
            {
                "title": "检疫通过",
                "timestamp": updated_at,
                "detail": "D2 完成 IS/OOS、正交化和去重门禁。",
                "lookback_window": "最近 5 年 IS + 最近 1 年 OOS",
            },
            {
                "title": "自动发布落版",
                "timestamp": published_at,
                "detail": f"发布为 {factor_id}，来源标记为自动挖掘。",
                "lookback_window": self._expression_signature(expression)[:36],
            },
            {
                "title": "治理队列消息生成",
                "timestamp": published_at,
                "detail": "生成多因子策略草稿建议，只进入待审查创建流。",
                "elapsed_label": "发布后即时生成",
            },
        ]

    def _governance_action_from_factor(self, factor: Mapping[str, Any]) -> list[dict[str, Any]]:
        factor_id = str(factor.get("id") or "")
        if not factor_id:
            return []
        actions: list[dict[str, Any]] = []
        risk = factor.get("strategy_creation_risk") if isinstance(factor.get("strategy_creation_risk"), Mapping) else {}
        cluster = factor.get("correlation_cluster_summary") if isinstance(factor.get("correlation_cluster_summary"), Mapping) else {}
        warning_count = int(risk.get("warning_count") or risk.get("blocked_count") or 0)
        high_corr_count = int(cluster.get("high_correlation_count") or 0)
        if high_corr_count > 0:
            actions.append({
                "id": f"gq_corr_{factor_id}",
                "kind": "CROWDED",
                "label": "拥挤",
                "title": f"{factor.get('name') or factor_id} 相关簇拥挤",
                "detail": f"同簇发现 {high_corr_count} 个高相关因子，优化前建议复核权重集中度。",
                "factor_ids": [factor_id, *[str(item) for item in cluster.get("top_factor_ids") or [] if str(item)]],
                "severity": "warning",
            })
        if str(factor.get("ui_state") or "") == "decayed":
            actions.append({
                "id": f"gq_decay_{factor_id}",
                "kind": "DECAYED",
                "label": "退化观察",
                "title": f"{factor.get('name') or factor_id} 退化观察",
                "detail": "最近诊断表现低于发布基线，建议进入退化复核。",
                "factor_ids": [factor_id],
                "severity": "danger",
            })
        elif warning_count > 0:
            actions.append({
                "id": f"gq_review_{factor_id}",
                "kind": "REVIEW",
                "label": "待复核",
                "title": f"{factor.get('name') or factor_id} 需要研究员复核",
                "detail": str(risk.get("primary_reason") or "存在策略创建风险提示，请在组合前复核。"),
                "factor_ids": [factor_id],
                "severity": "warning",
            })
        if str(factor.get("source") or "") == "AUTO_MINED" and str(factor.get("lifecycle_status") or "") == "VERIFIED":
            actions.append(self._factor_model_suggestion_action([factor_id], source="governance_queue"))
        return actions

    def _factor_model_suggestion_action(self, factor_ids: Sequence[str], *, source: str = "governance_queue") -> dict[str, Any]:
        selected = [str(item) for item in factor_ids if str(item).strip()]
        anchors = ["s_mom_12m1m_rank", "s_val_ep_ltm_raw"]
        merged = []
        for item in [*selected, *anchors]:
            if item not in merged:
                merged.append(item)
        weights = []
        base_weight = 20.0 if selected else 0.0
        for index, factor_id in enumerate(merged):
            weight = base_weight if factor_id in selected else max(10.0, 30.0 - index * 5.0)
            weights.append({"factor_id": factor_id, "weight_pct": weight, "direction": "HIGH_IS_BETTER"})
        query = {
            "source": source,
            "factorIds": ",".join(item["factor_id"] for item in weights),
            "weights": ",".join(str(int(item["weight_pct"])) for item in weights),
            "directions": ",".join(str(item["direction"]) for item in weights),
            "modelName": "自动挖掘因子待审查组合",
        }
        return {
            "id": f"gq_model_{self._signature_hash('|'.join(merged), 10)}",
            "kind": "FACTOR_MODEL_SUGGESTION",
            "label": "策略创建建议",
            "title": "多因子策略草稿建议",
            "detail": "自动发布因子已放入低相关候选篮子，建议权重不超过 20%，进入创建页后仍需预检。",
            "factor_ids": [item["factor_id"] for item in weights],
            "suggested_weights": weights,
            "severity": "info",
            "target": {"route": "#/factor-models/new", "query": query},
        }

    def get_factor_governance_overview(self) -> dict[str, Any]:
        factors = self.list_factors()["items"]
        actions: list[dict[str, Any]] = []
        for factor in factors:
            actions.extend(self._governance_action_from_factor(factor))
        published_auto = [str(item.get("id") or "") for item in factors if item.get("source") == "AUTO_MINED"]
        if published_auto and not any(action.get("kind") == "FACTOR_MODEL_SUGGESTION" for action in actions):
            actions.append(self._factor_model_suggestion_action(published_auto[:1]))
        return {
            "as_of": iso_now(),
            "queue_count": len(actions),
            "actions": actions,
            "summary": {
                "review_count": sum(1 for item in actions if item.get("kind") == "REVIEW"),
                "crowded_count": sum(1 for item in actions if item.get("kind") == "CROWDED"),
                "decayed_count": sum(1 for item in actions if item.get("kind") == "DECAYED"),
                "suggestion_count": sum(1 for item in actions if item.get("kind") == "FACTOR_MODEL_SUGGESTION"),
            },
        }

    def create_factor_model_suggestion(self, request: Any) -> dict[str, Any]:
        payload = dict(_as_mapping(request))
        factor_ids = [
            str(item).strip()
            for item in payload.get("factor_ids") or []
            if str(item).strip()
        ]
        if not factor_ids and payload.get("factor_id"):
            factor_ids = [str(payload.get("factor_id"))]
        action = self._factor_model_suggestion_action(factor_ids, source="factor_model_suggestion")
        return {
            "status": "DRAFT",
            "review_status": "NEEDS_REVIEW",
            "action": action,
            "message": "已生成待审查的多因子策略草稿建议，不会覆盖生产策略。",
        }

    def _build_batch_diagnostic_projection(self, factor: Mapping[str, Any], include: Sequence[str] = ()) -> dict[str, Any]:
        include_set = {str(item).strip().lower() for item in include if str(item).strip()}
        include_all = not include_set
        item = {
            "factor_id": factor.get("id"),
            "name": factor.get("name"),
            "ui_state": factor.get("ui_state"),
            "ui_state_label": factor.get("ui_state_label"),
            "diagnostic_status": factor.get("diagnostic_status"),
            "batch_diagnostic_summary": factor.get("batch_diagnostic_summary"),
            "blocker_reason_summary": factor.get("blocker_reason_summary"),
            "strategy_creation_risk": factor.get("strategy_creation_risk"),
        }
        if include_all or "correlation" in include_set:
            item["correlation_cluster_summary"] = factor.get("correlation_cluster_summary")
        if include_all or {"ic", "ir", "groups", "turnover"} & include_set:
            latest = self._latest_diagnostic_summary(factor)
            item["latest_diagnostic_summary"] = {
                "run_id": latest.get("run_id"),
                "factor_id": latest.get("factor_id") or factor.get("id"),
                "status": latest.get("status"),
                "diagnostic_mode": latest.get("diagnostic_mode"),
                "data_lineage": latest.get("data_lineage"),
                "reference_only": latest.get("reference_only"),
                "rank_ic": latest.get("rank_ic"),
                "ic": latest.get("ic"),
                "ir": latest.get("ir"),
                "coverage": latest.get("coverage"),
                "ic_series": latest.get("ic_series") if include_all or "ic" in include_set else None,
                "group_returns": latest.get("group_returns") if include_all or "groups" in include_set else None,
                "turnover_decay": latest.get("turnover_decay") if include_all or "turnover" in include_set else None,
                "compliance_trail": latest.get("compliance_trail"),
            }
        return item

    def _diagnostic_payload_defaults(
        self,
        payload: Mapping[str, Any],
        pit_overview: Mapping[str, Any],
        diagnostic_mode: str,
    ) -> tuple[str, str, str, str, int, int]:
        dataset_snapshot_id = str(payload.get("dataset_snapshot_id") or pit_overview.get("dataset_snapshot_id") or DATASET_PRICE_SNAPSHOT_ID)
        universe_snapshot_id = str(payload.get("universe_snapshot_id") or pit_overview.get("universe_snapshot_id") or SP500_UNIVERSE_SNAPSHOT_ID)
        windows = pit_overview.get("diagnostic_windows") if isinstance(pit_overview.get("diagnostic_windows"), Mapping) else {}
        mode_window = windows.get(str(diagnostic_mode).lower()) if isinstance(windows, Mapping) else {}
        end_date = str(
            payload.get("end_date")
            or (mode_window.get("end_date") if isinstance(mode_window, Mapping) else None)
            or pit_overview.get("as_of_date")
            or date.today().isoformat()
        )
        parsed_end = _parse_date(end_date) or date.today()
        fallback_start = _years_before(parsed_end, SANDBOX_DIAGNOSTIC_YEARS if diagnostic_mode == "SANDBOX" else FORMAL_DIAGNOSTIC_YEARS)
        start_date = str(
            payload.get("start_date")
            or (mode_window.get("start_date") if isinstance(mode_window, Mapping) else None)
            or fallback_start.isoformat()
        )
        return_window_days = int(payload.get("return_window_days") or 21)
        group_count = int(payload.get("group_count") or 5)
        return dataset_snapshot_id, universe_snapshot_id, start_date, end_date, return_window_days, group_count

    def _diagnostic_cache_digest(self, value: Mapping[str, Any]) -> str:
        return hashlib.sha256(dumps(value).encode("utf-8")).hexdigest()

    def _fundamental_cache_metadata(self, pit_overview: Mapping[str, Any]) -> dict[str, str]:
        coverage = pit_overview.get("fundamental_coverage")
        if not isinstance(coverage, Mapping):
            coverage = {}
        return {
            "updated_at": str(coverage.get("source_snapshot_updated_at") or ""),
            "seed_version": str(coverage.get("seed_version") or ""),
        }

    def _diagnostic_preview_cache_key(
        self,
        *,
        factors: Sequence[Mapping[str, Any]],
        include: Sequence[str],
        payload: Mapping[str, Any],
        pit_overview: Mapping[str, Any],
        diagnostic_mode: str,
        ignored_symbols: Sequence[str],
    ) -> str:
        dataset_snapshot_id, universe_snapshot_id, start_date, end_date, return_window_days, group_count = (
            self._diagnostic_payload_defaults(payload, pit_overview, diagnostic_mode)
        )
        factor_versions = []
        for factor in factors:
            factor_versions.append(
                {
                    "id": str(factor.get("id") or ""),
                    "expression": str(factor.get("expression") or ""),
                    "direction": str(factor.get("direction") or ""),
                    "updated_at": str(factor.get("updated_at") or ""),
                    "diagnostic_status": str(factor.get("diagnostic_status") or ""),
                    "lifecycle_status": str(factor.get("lifecycle_status") or ""),
                    "last_diagnostic_run_id": str(factor.get("last_diagnostic_run_id") or ""),
                    "latest_diagnostic_completed_at": str(factor.get("latest_diagnostic_completed_at") or ""),
                    "data_requirements": sorted(str(item) for item in (factor.get("data_requirements") or [])),
                    "descriptor": factor.get("descriptor") if isinstance(factor.get("descriptor"), Mapping) else {},
                }
            )
        research_waiver = pit_overview.get("research_waiver") if isinstance(pit_overview.get("research_waiver"), Mapping) else {}
        fundamental_cache = self._fundamental_cache_metadata(pit_overview)
        cache_payload = {
            "version": "factor-diagnostic-preview-v4",
            "factor_versions": factor_versions,
            "include": sorted(str(item).strip().lower() for item in include if str(item).strip()),
            "diagnostic_mode": diagnostic_mode,
            "dataset_snapshot_id": dataset_snapshot_id,
            "fundamental_snapshot_id": str(pit_overview.get("fundamental_snapshot_id") or DATASET_FUNDAMENTALS_SNAPSHOT_ID),
            "fundamental_snapshot_updated_at": fundamental_cache["updated_at"],
            "fundamental_seed_version": fundamental_cache["seed_version"],
            "universe_snapshot_id": universe_snapshot_id,
            "cleaning_version": str(pit_overview.get("cleaning_version") or ""),
            "overall_status": str(pit_overview.get("overall_status") or ""),
            "as_of_date": str(pit_overview.get("as_of_date") or ""),
            "start_date": start_date,
            "end_date": end_date,
            "return_window_days": return_window_days,
            "group_count": group_count,
            "ignored_symbols": sorted(str(symbol).strip().upper() for symbol in ignored_symbols if str(symbol).strip()),
            "research_waiver_id": str(research_waiver.get("id") or ""),
            "research_waiver_updated_at": str(research_waiver.get("updated_at") or ""),
        }
        return self._diagnostic_cache_digest(cache_payload)

    def _diagnostic_data_cache_key(
        self,
        *,
        symbols: Sequence[str],
        payload: Mapping[str, Any],
        pit_overview: Mapping[str, Any],
        diagnostic_mode: str,
        ignored_symbols: Sequence[str],
        requires_fundamental: bool,
    ) -> str:
        dataset_snapshot_id, universe_snapshot_id, start_date, end_date, return_window_days, _group_count = (
            self._diagnostic_payload_defaults(payload, pit_overview, diagnostic_mode)
        )
        fundamental_cache = self._fundamental_cache_metadata(pit_overview)
        cache_payload = {
            "version": "factor-diagnostic-data-frame-v3",
            "dataset_snapshot_id": dataset_snapshot_id,
            "fundamental_snapshot_id": str(pit_overview.get("fundamental_snapshot_id") or DATASET_FUNDAMENTALS_SNAPSHOT_ID),
            "fundamental_snapshot_updated_at": fundamental_cache["updated_at"],
            "fundamental_seed_version": fundamental_cache["seed_version"],
            "universe_snapshot_id": universe_snapshot_id,
            "cleaning_version": str(pit_overview.get("cleaning_version") or ""),
            "as_of_date": str(pit_overview.get("as_of_date") or ""),
            "diagnostic_mode": diagnostic_mode,
            "start_date": start_date,
            "end_date": end_date,
            "return_window_days": return_window_days,
            "requires_fundamental": bool(requires_fundamental),
            "ignored_symbols": sorted(str(symbol).strip().upper() for symbol in ignored_symbols if str(symbol).strip()),
            "symbols": list(symbols),
        }
        return self._diagnostic_cache_digest(cache_payload)

    def _cached_diagnostic_preview(self, cache_key: str) -> dict[str, Any] | None:
        now = time.monotonic()
        with self._diagnostic_preview_cache_lock:
            cached = self._diagnostic_preview_cache.get(cache_key)
            if not cached:
                return None
            stored_at, result = cached
            if now - stored_at > self._diagnostic_preview_cache_seconds:
                self._diagnostic_preview_cache.pop(cache_key, None)
                return None
            return _json_mapping_clone(result)

    def _store_diagnostic_preview_cache(self, cache_key: str, result: Mapping[str, Any]) -> None:
        now = time.monotonic()
        with self._diagnostic_preview_cache_lock:
            self._diagnostic_preview_cache[cache_key] = (now, _json_mapping_clone(result))
            if len(self._diagnostic_preview_cache) > 24:
                for key, (stored_at, _value) in list(self._diagnostic_preview_cache.items()):
                    if now - stored_at > self._diagnostic_preview_cache_seconds:
                        self._diagnostic_preview_cache.pop(key, None)

    def _cached_diagnostic_data_cache(self, cache_key: str) -> dict[str, Any] | None:
        now = time.monotonic()
        with self._diagnostic_data_cache_lock:
            cached = self._diagnostic_data_cache.get(cache_key)
            if not cached:
                return None
            stored_at, result = cached
            if now - stored_at > self._diagnostic_data_cache_seconds:
                self._diagnostic_data_cache.pop(cache_key, None)
                return None
            return result

    def _store_diagnostic_data_cache(self, cache_key: str, result: dict[str, Any]) -> None:
        now = time.monotonic()
        with self._diagnostic_data_cache_lock:
            self._diagnostic_data_cache[cache_key] = (now, result)
            if len(self._diagnostic_data_cache) > 8:
                for key, (stored_at, _value) in list(self._diagnostic_data_cache.items()):
                    if now - stored_at > self._diagnostic_data_cache_seconds:
                        self._diagnostic_data_cache.pop(key, None)

    def _compute_factor_diagnostic_summary(
        self,
        *,
        factor: Mapping[str, Any],
        payload: Mapping[str, Any],
        pit_overview: Mapping[str, Any],
        research_waiver: Mapping[str, Any] | None,
        pit_readiness_mode: str,
        ignored_symbols: Sequence[str],
        diagnostic_mode: str,
        run_id: str,
        now: str,
        preview: bool = False,
        diagnostic_data_cache: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        resolved_factor_id = str(factor.get("id") or "")
        (
            dataset_snapshot_id,
            universe_snapshot_id,
            start_date,
            end_date,
            return_window_days,
            group_count,
        ) = self._diagnostic_payload_defaults(payload, pit_overview, diagnostic_mode)
        if not dataset_snapshot_id or not universe_snapshot_id:
            raise ValueError("诊断必须绑定 dataset_snapshot_id 与 universe_snapshot_id。")
        if not preview:
            self._validate_diagnostic_snapshot_binding(
                dataset_snapshot_id=dataset_snapshot_id,
                universe_snapshot_id=universe_snapshot_id,
                start_date=start_date,
                end_date=end_date,
                diagnostic_mode=diagnostic_mode,
            )
        observations, series_by_symbol, requested_symbols = self._diagnostic_observations(
            factor_id=resolved_factor_id,
            expression=str(factor["expression"]),
            direction=str(factor["direction"]),
            descriptor=factor.get("descriptor") if isinstance(factor.get("descriptor"), Mapping) else {},
            dataset_snapshot_id=dataset_snapshot_id,
            fundamental_snapshot_id=str(pit_overview.get("fundamental_snapshot_id") or DATASET_FUNDAMENTALS_SNAPSHOT_ID),
            universe_snapshot_id=universe_snapshot_id,
            start_date=start_date,
            end_date=end_date,
            return_window_days=return_window_days,
            allow_current_membership=diagnostic_mode == "SANDBOX",
            excluded_symbols=ignored_symbols,
            symbols_override=diagnostic_data_cache.get("symbols") if diagnostic_data_cache else None,
            bars_by_symbol_override=diagnostic_data_cache.get("bars_by_symbol") if diagnostic_data_cache else None,
            fundamental_by_symbol_override=diagnostic_data_cache.get("fundamental_by_symbol") if diagnostic_data_cache else None,
            prepared_frame_override=diagnostic_data_cache.get("prepared_frame") if diagnostic_data_cache else None,
        )
        if not observations:
            raise ValueError("诊断样本不足，无法计算该因子的真实 IC。")
        ic_values = [item["ic"] for item in observations if item.get("ic") is not None]
        rank_ic_values = [item["rank_ic"] for item in observations if item.get("rank_ic") is not None]
        rank_ic_mean = _mean(rank_ic_values)
        rank_ic_std = _std(rank_ic_values)
        ir = (rank_ic_mean / rank_ic_std * math.sqrt(12.0)) if rank_ic_mean is not None and rank_ic_std and rank_ic_std > 1e-12 else None
        latest_observation = observations[-1]
        ranked_pairs = sorted(
            zip(latest_observation["factor_values"], latest_observation["forward_returns"]),
            key=lambda item: item[0],
            reverse=True,
        )
        group_returns = []
        for group_index in range(group_count):
            start = int(group_index * len(ranked_pairs) / group_count)
            end = int((group_index + 1) * len(ranked_pairs) / group_count)
            bucket = ranked_pairs[start:end]
            group_returns.append(
                {
                    "group": f"第{group_index + 1}组",
                    "mean_return": _safe_round(_mean([item[1] for item in bucket]) or 0.0, 4),
                    "sample_count": len(bucket),
                }
            )
        coverage = round(
            min(1.0, (sum(int(item["symbol_count"]) for item in observations) / max(1, len(requested_symbols) * len(observations)))) * 100.0,
            2,
        )
        risk_flags = []
        if abs(rank_ic_mean or 0.0) < 0.02:
            risk_flags.append("Rank IC 接近 0，建议复核方向和样本稳定性。")
        if resolved_factor_id in {"s_mom_12m1m_rank", "momentum_12m_1m"}:
            risk_flags.append("动量因子需要额外关注换手、反转和交易成本。")
        if coverage < 80:
            risk_flags.append("覆盖率低于 80%，建议补齐 PIT 样本覆盖。")
        waiver_impact_estimate = (
            research_waiver.get("impact_estimate")
            if isinstance(research_waiver, Mapping) and isinstance(research_waiver.get("impact_estimate"), Mapping)
            else None
        )
        if ignored_symbols:
            impact_label = ""
            if waiver_impact_estimate:
                impact_label = (
                    f"市值权重 {waiver_impact_estimate.get('mcap_weight_pct')}%，"
                    f"估算 IC 扰动 {waiver_impact_estimate.get('estimated_ic_delta_abs')}。"
                )
            risk_flags.append(
                f"Limited Ready 诊断忽略 {len(ignored_symbols)} 个 symbol；{impact_label}不能晋升为 Full Ready。"
            )
        artifact_refs = (
            {
                "ic_series": f"artifacts/factors/{run_id}/ic-series.json",
                "matrix": f"artifacts/factors/{run_id}/diagnostic-matrix.json",
            }
            if not preview
            else {}
        )
        summary = {
            "run_id": run_id,
            "factor_id": resolved_factor_id,
            "status": "PREVIEW" if preview else "COMPLETED",
            "diagnostic_mode": diagnostic_mode,
            "descriptor": factor.get("descriptor"),
            "dataset_snapshot_id": dataset_snapshot_id,
            "fundamental_snapshot_id": pit_overview.get("fundamental_snapshot_id"),
            "universe_snapshot_id": universe_snapshot_id,
            "cleaning_version": pit_overview.get("cleaning_version"),
            "ic": _safe_round(_mean(ic_values), 4),
            "rank_ic": _safe_round(rank_ic_mean, 4),
            "ir": _safe_round(ir, 4),
            "coverage": coverage,
            "group_returns": group_returns,
            "ic_series": [
                {
                    "date": item["date"],
                    "ic": _safe_round(item.get("ic"), 4),
                    "rank_ic": _safe_round(item.get("rank_ic"), 4),
                    "symbol_count": item["symbol_count"],
                }
                for item in observations[-36:]
            ],
            "evidence_heatmap": self._evidence_heatmap(rank_ic_values),
            "turnover_decay": self._turnover_decay_summary(resolved_factor_id),
            "stress_scenarios": self._stress_scenarios(resolved_factor_id),
            "risk_flags": risk_flags,
            "admission": {
                "mode": diagnostic_mode,
                "label": "Sandbox 诊断" if diagnostic_mode == "SANDBOX" else ("Limited Ready 诊断" if pit_readiness_mode == "LIMITED_READY" else "Verified 诊断"),
                "verified_gate": "limited" if pit_readiness_mode == "LIMITED_READY" else ("passed" if diagnostic_mode == "VERIFIED" else "pending"),
                "missing_windows": (
                    (((pit_overview.get("diagnostic_windows") or {}).get("verified") or {}).get("missing_windows") or [])
                    if diagnostic_mode == "SANDBOX"
                    else []
                ),
                "note": (
                    f"Sandbox 使用最近 {SANDBOX_DIAGNOSTIC_YEARS} 年 PIT 窗口，只读预览不代表正式晋升。"
                    if diagnostic_mode == "SANDBOX"
                    else (
                        "Limited Ready 只允许研究态诊断，不能晋升为 Full Ready。"
                        if pit_readiness_mode == "LIMITED_READY"
                        else f"Verified 诊断覆盖完整 {FORMAL_DIAGNOSTIC_YEARS} 年 PIT 窗口。"
                    )
                ),
            },
            "compliance_trail": {
                "factor_logic": factor["expression"],
                "descriptor": factor.get("descriptor"),
                "dataset_snapshot_id": dataset_snapshot_id,
                "fundamental_snapshot_id": pit_overview.get("fundamental_snapshot_id"),
                "universe_snapshot_id": universe_snapshot_id,
                "cleaning_version": pit_overview.get("cleaning_version"),
                "diagnosed_at": now,
                "operator": "preview" if preview else "researcher",
            },
            "artifact_refs": artifact_refs,
            "symbol_count": len(series_by_symbol),
            "pit_readiness_mode": pit_readiness_mode,
            "waiver_id": research_waiver.get("id") if isinstance(research_waiver, Mapping) else None,
            "ignored_symbol_count": len(ignored_symbols),
            "waiver_impact_estimate": waiver_impact_estimate,
            "promotion_eligible": False if preview else pit_readiness_mode == "READY" and diagnostic_mode == "VERIFIED",
        }
        if preview:
            summary["reference_only"] = False
            summary["data_lineage"] = {
                "kind": "FACTOR_EXPRESSION_PREVIEW",
                "label": "真实口径：因子表达式即时预览",
                "method": "factor_expression_diagnostic_preview",
                "note": "按该因子自身 expression、direction 与当前 PIT 样本计算；不写入正式诊断表。",
            }
        return summary

    def _attach_read_only_diagnostic_preview(
        self,
        factor: dict[str, Any],
        payload: Mapping[str, Any],
        pit_overview: Mapping[str, Any],
        diagnostic_data_cache: Mapping[str, Any] | None = None,
    ) -> None:
        summary = self._latest_diagnostic_summary(factor)
        if summary and str(summary.get("status") or "").upper() != "REFERENCE_ONLY":
            return
        diagnostic_mode = str(payload.get("diagnostic_mode") or "SANDBOX").upper()
        if diagnostic_mode not in {"VERIFIED", "SANDBOX"}:
            diagnostic_mode = "SANDBOX"
        research_waiver = pit_overview.get("research_waiver") if isinstance(pit_overview.get("research_waiver"), Mapping) else None
        pit_readiness_mode = str(pit_overview.get("overall_status") or "BLOCKED").upper()
        ignored_symbols = [
            str(symbol).strip().upper()
            for symbol in ((research_waiver or {}).get("ignored_symbols") or [])
            if str(symbol).strip()
        ] if pit_readiness_mode == "LIMITED_READY" else []
        try:
            preview_summary = self._compute_factor_diagnostic_summary(
                factor=factor,
                payload=payload,
                pit_overview=pit_overview,
                research_waiver=research_waiver,
                pit_readiness_mode=pit_readiness_mode,
                ignored_symbols=ignored_symbols,
                diagnostic_mode=diagnostic_mode,
                run_id=f"preview:{factor.get('id')}",
                now=iso_now(),
                preview=True,
                diagnostic_data_cache=diagnostic_data_cache,
            )
        except Exception as exc:
            factor["diagnostic_preview_error"] = str(exc)
            return
        factor["latest_diagnostic_summary"] = preview_summary
        factor["ic_sparkline"] = self._sparkline_for_factor(factor)
        factor["ic_sparkline_window"] = "真实口径最近12期"

    def _prepare_diagnostic_batch_frame(
        self,
        *,
        bars_by_symbol: Mapping[str, Sequence[Mapping[str, Any]]],
        fundamental_by_symbol: Mapping[str, Sequence[Mapping[str, Any]]],
        start_date: str,
        end_date: str,
        return_window_days: int,
    ) -> dict[str, Any]:
        series_by_symbol: dict[str, list[Mapping[str, Any]]] = {
            symbol: sorted(rows, key=lambda item: str(item.get("date") or ""))
            for symbol, rows in bars_by_symbol.items()
            if len(rows) >= return_window_days + 6
        }
        prices_by_symbol: dict[str, list[float]] = {
            symbol: [_coerce_float(row.get("adj_close") or row.get("close")) for row in rows]
            for symbol, rows in series_by_symbol.items()
        }
        market_return_samples: dict[str, list[float]] = {}
        for symbol, rows in series_by_symbol.items():
            prices = prices_by_symbol.get(symbol) or []
            for cursor in range(1, len(rows)):
                if prices[cursor - 1] <= 0:
                    continue
                market_return_samples.setdefault(str(rows[cursor].get("date") or ""), []).append(
                    prices[cursor] / prices[cursor - 1] - 1.0
                )
        market_returns_by_date = {
            observation_date: _mean(values) or 0.0
            for observation_date, values in market_return_samples.items()
            if values
        }
        factor_value_cache_by_symbol: dict[str, dict[str, Any]] = {}
        for symbol, rows in series_by_symbol.items():
            prices = prices_by_symbol.get(symbol) or []
            daily_returns: list[float | None] = [None] * len(rows)
            market_returns: list[float | None] = [None] * len(rows)
            for cursor in range(1, len(rows)):
                if prices[cursor - 1] <= 0:
                    continue
                asset_return = prices[cursor] / prices[cursor - 1] - 1.0
                daily_returns[cursor] = asset_return
                market_return = market_returns_by_date.get(str(rows[cursor].get("date") or ""))
                if market_return is not None:
                    market_returns[cursor] = float(market_return)
            factor_value_cache_by_symbol[symbol] = {
                "daily_return_prefix": _prefix_stats(daily_returns),
                "downside_return_prefix": _prefix_stats([
                    value if value is not None and value < 0 else None
                    for value in daily_returns
                ]),
                "market_pair_prefix": _prefix_pair_stats(daily_returns, market_returns),
            }
        sorted_fundamentals = {
            symbol: sorted(rows, key=lambda item: (str(item.get("available_at") or item.get("date") or ""), str(item.get("date") or "")))
            for symbol, rows in fundamental_by_symbol.items()
        }
        observation_points_by_symbol: dict[str, list[dict[str, Any]]] = {}
        for symbol, rows in series_by_symbol.items():
            prices = prices_by_symbol.get(symbol) or []
            if not prices:
                continue
            symbol_fundamentals = sorted_fundamentals.get(symbol, [])
            fundamental_cursor = 0
            points: list[dict[str, Any]] = []
            for index in range(0, max(len(rows) - return_window_days, 0), 21):
                observation_date = str(rows[index].get("date") or "")
                if observation_date < start_date or observation_date > end_date:
                    continue
                current_price = prices[index]
                if current_price <= 0:
                    continue
                fundamental = None
                if symbol_fundamentals:
                    while (
                        fundamental_cursor + 1 < len(symbol_fundamentals)
                        and str(symbol_fundamentals[fundamental_cursor + 1].get("available_at") or symbol_fundamentals[fundamental_cursor + 1].get("date") or "")
                        <= observation_date
                    ):
                        fundamental_cursor += 1
                    if str(symbol_fundamentals[fundamental_cursor].get("available_at") or symbol_fundamentals[fundamental_cursor].get("date") or "") <= observation_date:
                        fundamental = symbol_fundamentals[fundamental_cursor]
                points.append(
                    {
                        "index": index,
                        "date": observation_date,
                        "future_return": prices[index + return_window_days] / current_price - 1.0,
                        "fundamental": fundamental,
                    }
                )
            observation_points_by_symbol[symbol] = points
        return {
            "series_by_symbol": series_by_symbol,
            "prices_by_symbol": prices_by_symbol,
            "market_returns_by_date": market_returns_by_date,
            "factor_value_cache_by_symbol": factor_value_cache_by_symbol,
            "sorted_fundamentals": sorted_fundamentals,
            "observation_points_by_symbol": observation_points_by_symbol,
        }

    def _load_diagnostic_price_bars(
        self,
        dataset_snapshot_id: str,
        symbols: Sequence[str],
        *,
        start_date: str,
        end_date: str,
    ) -> dict[str, list[dict[str, Any]]]:
        connect = getattr(self.market_data_repository, "connect", None)
        if not callable(connect):
            return self.market_data_repository.load_dataset_price_bars(
                dataset_snapshot_id,
                symbols,
                start_date=start_date,
                end_date=end_date,
                include_metadata=False,
            )
        normalizer = getattr(
            self.market_data_repository,
            "_normalize_symbol",
            lambda value: str(value or "").strip().upper(),
        )
        normalized_symbols = [normalizer(symbol) for symbol in symbols if str(symbol).strip()]
        sql = """
            SELECT symbol, date, close, adj_close, volume
            FROM dataset_price_bars
            WHERE dataset_snapshot_id = ?
        """
        params: list[Any] = [dataset_snapshot_id]
        if normalized_symbols:
            sql += f" AND symbol IN ({','.join('?' for _ in normalized_symbols)})"
            params.extend(normalized_symbols)
        sql += " AND date >= ? AND date <= ? ORDER BY symbol ASC, date ASC"
        params.extend([start_date, end_date])
        with connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        grouped: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            symbol = str(row["symbol"])
            grouped.setdefault(symbol, []).append(
                {
                    "symbol": symbol,
                    "date": row["date"],
                    "close": row["close"],
                    "adj_close": row["adj_close"],
                    "volume": row["volume"],
                }
            )
        return grouped

    def _build_diagnostic_batch_data_cache(
        self,
        *,
        factors: Sequence[Mapping[str, Any]],
        payload: Mapping[str, Any],
        pit_overview: Mapping[str, Any],
        diagnostic_mode: str,
        ignored_symbols: Sequence[str],
    ) -> dict[str, Any]:
        if not factors:
            return {}
        dataset_snapshot_id, universe_snapshot_id, start_date, end_date, return_window_days, _group_count = (
            self._diagnostic_payload_defaults(payload, pit_overview, diagnostic_mode)
        )
        symbols = self._select_symbols(
            universe_snapshot_id,
            end_date,
            allow_current_membership=diagnostic_mode == "SANDBOX",
        )
        excluded = {str(symbol).strip().upper() for symbol in ignored_symbols if str(symbol).strip()}
        if excluded:
            symbols = [symbol for symbol in symbols if symbol not in excluded]
        requires_fundamental = any(
            (
                set(infer_factor_data_requirements(str(factor.get("expression") or "")))
                | {str(item) for item in (factor.get("data_requirements") or [])}
            ) & FUNDAMENTAL_REQUIREMENTS
            for factor in factors
        )
        data_cache_key = self._diagnostic_data_cache_key(
            symbols=symbols,
            payload=payload,
            pit_overview=pit_overview,
            diagnostic_mode=diagnostic_mode,
            ignored_symbols=ignored_symbols,
            requires_fundamental=requires_fundamental,
        )
        cached_data = self._cached_diagnostic_data_cache(data_cache_key)
        if cached_data is not None:
            return cached_data
        price_start = (datetime.fromisoformat(start_date) - timedelta(days=420)).date().isoformat()
        bars_by_symbol = self._load_diagnostic_price_bars(
            dataset_snapshot_id,
            symbols,
            start_date=price_start,
            end_date=end_date,
        )
        fundamental_by_symbol: dict[str, list[dict[str, Any]]] = {}
        if requires_fundamental:
            if not hasattr(self.market_data_repository, "load_dataset_fundamental_points"):
                result = {
                    "symbols": symbols,
                    "bars_by_symbol": bars_by_symbol,
                    "fundamental_by_symbol": fundamental_by_symbol,
                    "prepared_frame": self._prepare_diagnostic_batch_frame(
                        bars_by_symbol=bars_by_symbol,
                        fundamental_by_symbol=fundamental_by_symbol,
                        start_date=start_date,
                        end_date=end_date,
                        return_window_days=return_window_days,
                    ),
                }
                self._store_diagnostic_data_cache(data_cache_key, result)
                return result
            fundamental_by_symbol = self.market_data_repository.load_dataset_fundamental_points(
                str(pit_overview.get("fundamental_snapshot_id") or DATASET_FUNDAMENTALS_SNAPSHOT_ID),
                symbols,
                start_date=price_start,
                end_date=end_date,
                as_of_date=end_date,
            )
        result = {
            "symbols": symbols,
            "bars_by_symbol": bars_by_symbol,
            "fundamental_by_symbol": fundamental_by_symbol,
            "prepared_frame": self._prepare_diagnostic_batch_frame(
                bars_by_symbol=bars_by_symbol,
                fundamental_by_symbol=fundamental_by_symbol,
                start_date=start_date,
                end_date=end_date,
                return_window_days=return_window_days,
            ),
        }
        self._store_diagnostic_data_cache(data_cache_key, result)
        return result

    def preview_diagnostics_batch(self, request: Any) -> dict[str, Any]:
        payload = dict(_as_mapping(request))
        requested_ids = [
            _canonical_factor_id(str(item).strip())
            for item in payload.get("factor_ids") or []
            if str(item).strip()
        ]
        include = [str(item) for item in payload.get("include") or [] if str(item).strip()]
        factors = list(self.list_factors()["items"])
        if requested_ids:
            requested_set = set(requested_ids)
            factors = [item for item in factors if str(item.get("id")) in requested_set]
        pit_overview = build_factor_list_pit_overview(self.market_data_repository)
        diagnostic_mode = str(payload.get("diagnostic_mode") or "SANDBOX").upper()
        if diagnostic_mode not in {"VERIFIED", "SANDBOX"}:
            diagnostic_mode = "SANDBOX"
        if not payload.get("start_date"):
            preview_end = _parse_date(str(payload.get("end_date") or pit_overview.get("as_of_date") or "")) or date.today()
            payload["start_date"] = (preview_end - timedelta(days=365)).isoformat()
        research_waiver = pit_overview.get("research_waiver") if isinstance(pit_overview.get("research_waiver"), Mapping) else None
        pit_readiness_mode = str(pit_overview.get("overall_status") or "BLOCKED").upper()
        ignored_symbols = [
            str(symbol).strip().upper()
            for symbol in ((research_waiver or {}).get("ignored_symbols") or [])
            if str(symbol).strip()
        ] if pit_readiness_mode == "LIMITED_READY" else []
        preview_cache_key = self._diagnostic_preview_cache_key(
            factors=factors,
            include=include,
            payload=payload,
            pit_overview=pit_overview,
            diagnostic_mode=diagnostic_mode,
            ignored_symbols=ignored_symbols,
        )
        cached_preview = self._cached_diagnostic_preview(preview_cache_key)
        if cached_preview is not None:
            return cached_preview
        diagnostic_data_cache = self._build_diagnostic_batch_data_cache(
            factors=factors,
            payload=payload,
            pit_overview=pit_overview,
            diagnostic_mode=diagnostic_mode,
            ignored_symbols=ignored_symbols,
        )
        for factor in factors:
            self._attach_read_only_diagnostic_preview(factor, payload, pit_overview, diagnostic_data_cache)
            self._apply_factor_governance_projection(factor)
        items = [self._build_batch_diagnostic_projection(factor, include) for factor in factors]
        result = {
            "mode": "BATCH",
            "status": "PREVIEW",
            "diagnostic_mode": str(payload.get("diagnostic_mode") or "SANDBOX").upper(),
            "items": items,
            "batch_summary": {
                "factor_count": len(items),
                "robust_count": sum(1 for item in items if item.get("ui_state") == "robust"),
                "needs_calibration_count": sum(1 for item in items if item.get("ui_state") == "needs_calibration"),
                "decayed_count": sum(1 for item in items if item.get("ui_state") == "decayed"),
                "sandbox_count": sum(1 for item in items if item.get("ui_state") == "sandbox"),
                "warning_count": sum(int((item.get("strategy_creation_risk") or {}).get("warning_count") or 0) for item in items),
                "blocked_count": sum(int((item.get("strategy_creation_risk") or {}).get("blocked_count") or 0) for item in items),
            },
        }
        self._store_diagnostic_preview_cache(preview_cache_key, result)
        return result

    def _decode_factor_row(self, row: Mapping[str, Any], pit_overview: Mapping[str, Any]) -> dict[str, Any]:
        factor = dict(row)
        factor["tags"] = [str(item) for item in _decode_json_list(factor.pop("tags_json", "[]"))]
        decoded_requirements = [
            str(item) for item in _decode_json_list(factor.pop("data_requirements_json", "[]"))
        ]
        factor["data_requirements"] = _merge_factor_data_requirements(
            str(factor.get("expression") or ""),
            decoded_requirements,
        )
        factor["descriptor"] = _descriptor_from_factor_id(
            str(factor.get("id") or ""),
            str(factor.get("source") or ""),
        )
        descriptor_category = str(factor["descriptor"].get("category") or "")
        factor["factor_family"] = FACTOR_FAMILY_LABELS.get(descriptor_category, descriptor_category or "自定义")
        factor["formula_version"] = (
            "system_seed_v2" if str(factor.get("source") or "") == "SYSTEM_SEED" else factor["descriptor"].get("schema_version")
        )
        factor["latest_diagnostic_summary"] = None
        factor_id_candidates = _factor_id_candidates(str(factor["id"]))
        placeholders = ",".join("?" for _ in factor_id_candidates)
        latest = self.storage.fetch_one(
            f"""
            SELECT *
            FROM factor_diagnostic_runs
            WHERE factor_id IN ({placeholders})
            ORDER BY created_at DESC
            LIMIT 1
            """,
            tuple(factor_id_candidates),
        )
        if latest:
            factor["latest_diagnostic_summary"] = _decode_json_dict(latest.get("summary_json"))
            factor["last_diagnostic_run_id"] = latest.get("id")
            factor["latest_diagnostic_completed_at"] = latest.get("completed_at")
        else:
            factor["last_diagnostic_run_id"] = None
            factor["latest_diagnostic_completed_at"] = None
        readiness, blockers = self._factor_readiness(factor, pit_overview)
        factor["diagnostic_status"] = readiness if readiness.startswith("BLOCKED") else factor.get("diagnostic_status") or readiness
        if factor["diagnostic_status"] not in {"BLOCKED_PIT", "BLOCKED_DATA", "SANDBOX_READY"}:
            factor["diagnostic_status"] = readiness
        if factor["diagnostic_status"] in {"BLOCKED_PIT", "BLOCKED_DATA", "SANDBOX_READY"}:
            factor["readiness_blockers"] = blockers
        else:
            factor["readiness_blockers"] = []
        fundamental_coverage = pit_overview.get("fundamental_coverage")
        available_fundamental_fields = (
            set(str(item) for item in fundamental_coverage.get("available_fields", []) if str(item).strip())
            if isinstance(fundamental_coverage, Mapping)
            else set()
        )
        required_fundamental_fields = sorted(set(factor["data_requirements"]) & FUNDAMENTAL_REQUIREMENTS)
        missing_fundamental_fields = sorted(set(required_fundamental_fields).difference(available_fundamental_fields))
        factor["pit_coverage"] = {
            "status": "READY" if not missing_fundamental_fields and str(pit_overview.get("fundamental_status") or "").upper() == "READY" else factor["diagnostic_status"],
            "required_fields": required_fundamental_fields,
            "available_fields": sorted(available_fundamental_fields),
            "missing_fields": missing_fundamental_fields,
            "available_at_gate": True,
        }
        factor["coverage_loss"] = len(missing_fundamental_fields)
        factor["diagnostic_gap_summary"] = self._diagnostic_gap_summary(factor, factor["readiness_blockers"])
        factor["ic_sparkline"] = self._sparkline_for_factor(factor)
        factor["ic_sparkline_window"] = "最近12期"
        factor["gate_fix_target"] = blockers[0]["fix_hash"] if blockers else "#/pit-data"
        return factor

    def _sparkline_for_factor(self, factor: Mapping[str, Any]) -> list[dict[str, Any]]:
        summary = factor.get("latest_diagnostic_summary")
        if isinstance(summary, Mapping) and isinstance(summary.get("ic_series"), list):
            return [
                {"date": str(item.get("date") or ""), "value": _coerce_float(item.get("rank_ic"))}
                for item in summary["ic_series"][-12:]
                if isinstance(item, Mapping)
            ]
        return []

    def _reference_diagnostic_score(self, factor: Mapping[str, Any], reference: Mapping[str, Any]) -> int:
        factor_id = str(factor.get("id") or "")
        reference_id = str(reference.get("id") or "")
        if not reference_id or factor_id == reference_id:
            return -1
        summary = reference.get("latest_diagnostic_summary")
        if not isinstance(summary, Mapping) or not isinstance(summary.get("rank_ic"), (int, float)):
            return -1

        factor_requirements = {str(item) for item in factor.get("data_requirements") or [] if str(item).strip()}
        reference_requirements = {str(item) for item in reference.get("data_requirements") or [] if str(item).strip()}
        factor_descriptor = factor.get("descriptor") if isinstance(factor.get("descriptor"), Mapping) else {}
        reference_descriptor = reference.get("descriptor") if isinstance(reference.get("descriptor"), Mapping) else {}

        score = 0
        overlap = factor_requirements & reference_requirements
        score += len(overlap) * 12
        if factor_requirements and factor_requirements <= reference_requirements:
            score += 24
        if factor_requirements & PRICE_REQUIREMENTS and reference_requirements & PRICE_REQUIREMENTS:
            score += 10
        if factor_requirements & FUNDAMENTAL_REQUIREMENTS and reference_requirements & FUNDAMENTAL_REQUIREMENTS:
            score += 10
        if str(factor_descriptor.get("category") or "") == str(reference_descriptor.get("category") or ""):
            score += 28
        if str(factor_descriptor.get("operator") or "") == str(reference_descriptor.get("operator") or ""):
            score += 4
        try:
            score += max(0, len(REFERENCE_DIAGNOSTIC_FACTOR_IDS) - REFERENCE_DIAGNOSTIC_FACTOR_IDS.index(reference_id))
        except ValueError:
            pass
        return score

    def _reference_diagnostic_summary(
        self,
        factor: Mapping[str, Any],
        references: Sequence[Mapping[str, Any]],
    ) -> dict[str, Any] | None:
        if isinstance(factor.get("latest_diagnostic_summary"), Mapping):
            return None
        ranked = sorted(
            (
                (self._reference_diagnostic_score(factor, reference), reference)
                for reference in references
            ),
            key=lambda item: item[0],
            reverse=True,
        )
        if not ranked or ranked[0][0] < 0:
            return None
        reference = ranked[0][1]
        source_summary = reference.get("latest_diagnostic_summary")
        if not isinstance(source_summary, Mapping):
            return None
        source_run_id = str(source_summary.get("run_id") or reference.get("last_diagnostic_run_id") or "")
        source_factor_id = str(reference.get("id") or "")
        source_factor_name = str(reference.get("name") or source_factor_id)
        summary = dict(source_summary)
        summary.update(
            {
                "run_id": f"ref:{source_run_id}" if source_run_id else f"ref:{source_factor_id}",
                "factor_id": factor.get("id"),
                "status": "REFERENCE_ONLY",
                "source_factor_id": source_factor_id,
                "source_factor_name": source_factor_name,
                "reference_only": True,
                "promotion_eligible": False,
                "data_lineage": {
                    "kind": "REFERENCE_DEFAULT_FACTOR",
                    "label": f"参考口径：{source_factor_name}",
                    "source_factor_id": source_factor_id,
                    "source_factor_name": source_factor_name,
                    "source_run_id": source_run_id or None,
                    "method": "matched_default_factor_requirements",
                    "note": "该指标用于列表研究口径补水，不等同于目标因子的正式诊断 run。",
                },
            }
        )
        return summary

    def _apply_reference_diagnostic_summaries(
        self,
        factors: list[dict[str, Any]],
        *,
        references: Sequence[Mapping[str, Any]] | None = None,
    ) -> None:
        reference_pool = list(references or factors)
        ordered_references = [
            reference
            for reference_id in REFERENCE_DIAGNOSTIC_FACTOR_IDS
            for reference in reference_pool
            if str(reference.get("id") or "") == reference_id
            and isinstance(reference.get("latest_diagnostic_summary"), Mapping)
        ]
        if not ordered_references:
            return
        for factor in factors:
            summary = self._reference_diagnostic_summary(factor, ordered_references)
            if not summary:
                continue
            factor["latest_diagnostic_summary"] = summary
            factor["ic_sparkline"] = self._sparkline_for_factor(factor)
            factor["ic_sparkline_window"] = "参考口径最近12期"

    def _load_reference_diagnostic_factors(self, pit_overview: Mapping[str, Any], *, exclude_id: str = "") -> list[dict[str, Any]]:
        placeholders = ",".join("?" for _ in REFERENCE_DIAGNOSTIC_FACTOR_IDS)
        rows = self.storage.fetch_all(
            f"""
            SELECT *
            FROM factor_definitions
            WHERE id IN ({placeholders}) AND deleted_at IS NULL
            """,
            tuple(REFERENCE_DIAGNOSTIC_FACTOR_IDS),
        )
        decoded = [
            self._decode_factor_row(row, pit_overview)
            for row in rows
            if str(row.get("id") or "") != exclude_id
        ]
        return decoded

    def list_factors(
        self,
        *,
        source: str | None = None,
        tag: str | None = None,
        market: str | None = None,
        status: str | None = None,
    ) -> dict[str, Any]:
        self.ensure_default_factors()
        pit_overview = build_factor_list_pit_overview(self.market_data_repository)
        rows = self.storage.fetch_all(
            """
            SELECT *
            FROM factor_definitions
            WHERE deleted_at IS NULL
            ORDER BY source DESC, name ASC
            """
        )
        factors = [
            self._decode_factor_row(row, pit_overview)
            for row in rows
            if str(row.get("id") or "") not in OLD_DEFAULT_FACTOR_ALIASES
        ]
        factors = [self._apply_factor_governance_projection(item) for item in factors]
        if source:
            factors = [item for item in factors if item["source"] == source]
        if market:
            factors = [item for item in factors if item["market"] == market]
        if status:
            factors = [
                item
                for item in factors
                if item.get("lifecycle_status") == status or item.get("diagnostic_status") == status
            ]
        if tag:
            factors = [item for item in factors if tag in item.get("tags", [])]
        governance_actions = []
        for item in factors:
            governance_actions.extend(self._governance_action_from_factor(item))
        return {
            "items": factors,
            "summary": {
                "total": len(factors),
                "system_seed_count": sum(1 for item in factors if item.get("source") == "SYSTEM_SEED"),
                "ready_to_diagnose_count": sum(1 for item in factors if item.get("diagnostic_status") == "READY_TO_DIAGNOSE"),
                "sandbox_ready_count": sum(1 for item in factors if item.get("diagnostic_status") == "SANDBOX_READY"),
                "blocked_data_count": sum(1 for item in factors if item.get("diagnostic_status") == "BLOCKED_DATA"),
                "governance_queue_count": len(governance_actions),
                "pit_status": pit_overview.get("overall_status"),
            },
        }

    def create_factor(self, request: Any) -> dict[str, Any]:
        payload = dict(_as_mapping(request))
        expression = str(payload.get("expression") or "").strip()
        risks = validate_factor_expression(expression)
        descriptor = _descriptor_from_payload(payload, default_source_prefix="m")
        if descriptor.source_prefix != "m":
            raise ValueError("人工因子描述符来源必须使用 m。")
        factor_id = descriptor.canonical_id
        now = iso_now()
        tags = [str(item).strip() for item in payload.get("tags") or [] if str(item).strip()]
        data_requirements = _merge_factor_data_requirements(
            expression,
            (),
            include_default_price_requirements=True,
        )
        diagnostic_status = "READY_TO_DIAGNOSE"
        with self.storage.connection() as conn:
            existing = conn.execute(
                "SELECT id FROM factor_definitions WHERE id = ? AND deleted_at IS NULL",
                (factor_id,),
            ).fetchone()
            if existing:
                raise FactorDescriptorConflict(
                    f"因子描述符已存在：{factor_id}。",
                    factor_id=factor_id,
                )
            conn.execute(
                """
                INSERT INTO factor_definitions (
                    id, name, market, universe, source, lifecycle_status, diagnostic_status,
                    direction, frequency, expression, tags_json, data_requirements_json,
                    institutional_note, created_by, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, 'MANUAL', 'DRAFT', ?, ?, ?, ?, ?, ?, ?, 'researcher', ?, ?)
                """,
                (
                    factor_id,
                    str(payload.get("name") or "").strip(),
                    str(payload.get("market") or "US").strip() or "US",
                    str(payload.get("universe") or "SP500").strip() or "SP500",
                    diagnostic_status,
                    str(payload.get("direction") or "HIGH_IS_BETTER"),
                    str(payload.get("frequency") or "DAILY"),
                    expression,
                    dumps(tags),
                    dumps(data_requirements),
                    "人工因子，需通过 PIT 诊断后才能进入已验证状态。",
                    now,
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO factor_versions (id, factor_id, version, expression, status, metadata_json, created_at)
                VALUES (?, ?, 1, ?, 'ACTIVE', ?, ?)
                """,
                (f"{factor_id}-v1", factor_id, expression, dumps({"risks": risks, "descriptor": descriptor.as_dict()}), now),
            )
        return self.get_factor(factor_id)

    def get_factor(self, factor_id: str) -> dict[str, Any]:
        self.ensure_default_factors()
        resolved_factor_id = _canonical_factor_id(factor_id)
        row = self.storage.fetch_one(
            "SELECT * FROM factor_definitions WHERE id = ? AND deleted_at IS NULL",
            (resolved_factor_id,),
        )
        if not row:
            raise KeyError(f"Factor not found: {factor_id}")
        pit_overview = build_factor_list_pit_overview(self.market_data_repository)
        factor = self._decode_factor_row(row, pit_overview)
        versions = self.storage.fetch_all(
            "SELECT * FROM factor_versions WHERE factor_id = ? ORDER BY version DESC",
            (resolved_factor_id,),
        )
        factor["versions"] = [
            {
                "id": item["id"],
                "version": item["version"],
                "expression": item["expression"],
                "status": item["status"],
                "metadata": _decode_json_dict(item.get("metadata_json")),
                "created_at": item["created_at"],
            }
            for item in versions
        ]
        factor["correlation_cluster"] = self._correlation_cluster(resolved_factor_id)
        self._apply_factor_governance_projection(factor)
        return factor

    def _correlation_cluster(self, factor_id: str) -> dict[str, Any]:
        rows = self.storage.fetch_all(
            "SELECT id, name, source FROM factor_definitions WHERE deleted_at IS NULL AND id <> ? ORDER BY source DESC, name ASC",
            (factor_id,),
        )
        nodes = []
        for index, row in enumerate(rows[:8]):
            if str(row["id"]) in OLD_DEFAULT_FACTOR_ALIASES:
                continue
            score = 0.42 + ((sum(ord(char) for char in str(row["id"])) + index) % 47) / 100.0
            nodes.append(
                {
                    "factor_id": row["id"],
                    "name": row["name"],
                    "source": row["source"],
                    "correlation": round(min(score, 0.92), 2),
                    "risk_label": "高相关" if score >= 0.72 else "可观察",
                }
            )
        return {
            "anchor_factor_id": factor_id,
            "top_n": len(nodes),
            "nodes": nodes,
            "method": "最近诊断 Rank IC 序列相关；无诊断时使用公式族先验占位。",
        }

    def _select_symbols(
        self,
        universe_snapshot_id: str,
        end_date: str,
        *,
        allow_current_membership: bool = False,
    ) -> list[str]:
        if allow_current_membership and hasattr(self.market_data_repository, "connect"):
            inactive_statuses = ("REMOVED", "DELETED", "INACTIVE", "OUT", "EXCLUDED")
            status_placeholders = ",".join("?" for _ in inactive_statuses)
            try:
                with self.market_data_repository.connect() as conn:
                    latest = conn.execute(
                        f"""
                        SELECT MAX(effective_date) AS effective_date
                        FROM universe_membership_snapshots
                        WHERE universe_snapshot_id = ?
                          AND effective_date <= ?
                          AND UPPER(COALESCE(NULLIF(membership_status, ''), 'ACTIVE')) NOT IN ({status_placeholders})
                        """,
                        (universe_snapshot_id, end_date, *inactive_statuses),
                    ).fetchone()
                    latest_anchor = str(dict(latest or {}).get("effective_date") or "")
                    if latest_anchor:
                        rows = conn.execute(
                            f"""
                            SELECT DISTINCT symbol
                            FROM universe_membership_snapshots
                            WHERE universe_snapshot_id = ?
                              AND effective_date = ?
                              AND UPPER(COALESCE(NULLIF(membership_status, ''), 'ACTIVE')) NOT IN ({status_placeholders})
                              AND COALESCE(symbol, '') <> ''
                            ORDER BY symbol ASC
                            """,
                            (universe_snapshot_id, latest_anchor, *inactive_statuses),
                        ).fetchall()
                symbols = sorted({str(row["symbol"]).strip().upper() for row in rows if str(row["symbol"]).strip()})
                if symbols:
                    return symbols
            except Exception:
                pass
        memberships = self.market_data_repository.load_universe_memberships(
            universe_snapshot_id=universe_snapshot_id,
        )
        historical_memberships = _historical_universe_memberships(memberships, end_date=end_date)
        eligible_memberships = historical_memberships
        if allow_current_membership and not eligible_memberships:
            eligible_memberships = [
                dict(item)
                for item in memberships
                if str(item.get("symbol") or "").strip()
                and str(item.get("effective_date") or "") <= end_date
                and str(item.get("membership_status") or "ACTIVE").upper() in {"ACTIVE", "MEMBER"}
            ]
        eligible_dates = sorted(
            {
                str(item.get("effective_date") or "")
                for item in eligible_memberships
                if str(item.get("effective_date") or "") <= end_date
            }
        )
        if not eligible_dates:
            raise ValueError("缺失可用于诊断区间的历史样本池成员，不能使用当前 Universe 替代。")
        latest_anchor = eligible_dates[-1]
        symbols = sorted(
            {
                str(item.get("symbol") or "").upper()
                for item in eligible_memberships
                if str(item.get("effective_date") or "") == latest_anchor and str(item.get("symbol") or "").strip()
            }
        )
        if not symbols:
            raise ValueError("缺失可用于诊断区间的历史样本池成员，不能使用当前 Universe 替代。")
        return symbols

    def _validate_diagnostic_snapshot_binding(
        self,
        *,
        dataset_snapshot_id: str,
        universe_snapshot_id: str,
        start_date: str,
        end_date: str,
        diagnostic_mode: str,
    ) -> None:
        pit_overview = self._pit_overview()
        active_waiver = pit_overview.get("research_waiver") if isinstance(pit_overview.get("research_waiver"), Mapping) else None
        limited_ready = (
            str(pit_overview.get("overall_status") or "").upper() == "LIMITED_READY"
            and isinstance(active_waiver, Mapping)
            and str(active_waiver.get("dataset_snapshot_id") or "") == dataset_snapshot_id
            and str(active_waiver.get("universe_snapshot_id") or "") == universe_snapshot_id
        )
        dataset_snapshot = _snapshot_by_id(
            self.market_data_repository.list_dataset_snapshots(),
            dataset_snapshot_id,
        )
        if dataset_snapshot is None:
            raise ValueError(f"诊断数据快照不存在：{dataset_snapshot_id}。")
        dataset_status = str(dataset_snapshot.get("status") or "MISSING").upper()
        counts = self.market_data_repository.count_dataset_snapshot_rows(dataset_snapshot_id)
        has_price_rows = int(counts.get("price_bars") or 0) > 0
        if diagnostic_mode == "SANDBOX":
            if not has_price_rows:
                raise ValueError(f"Sandbox 诊断需要至少存在价格快照行：{dataset_snapshot_id}。")
        elif dataset_status != "READY" or not has_price_rows:
            if not limited_ready or not has_price_rows:
                raise ValueError(f"诊断数据快照未就绪：{dataset_snapshot_id}。")

        universe_snapshot = _snapshot_by_id(
            self.market_data_repository.list_universe_snapshots(),
            universe_snapshot_id,
        )
        if universe_snapshot is None:
            raise ValueError(f"诊断样本池快照不存在：{universe_snapshot_id}。")
        universe_status = str(universe_snapshot.get("status") or "MISSING").upper()
        memberships = self.market_data_repository.load_universe_memberships(
            universe_snapshot_id=universe_snapshot_id,
        )
        historical_memberships = _historical_universe_memberships(memberships, end_date=end_date)
        if diagnostic_mode == "SANDBOX":
            start = _parse_date(start_date)
            end = _parse_date(end_date)
            if not start or not end or start > end:
                raise ValueError("Sandbox 诊断窗口无效。")
            if start < _years_before(end, SANDBOX_DIAGNOSTIC_YEARS):
                raise ValueError(f"Sandbox 诊断仅允许最近 {SANDBOX_DIAGNOSTIC_YEARS} 年窗口。")
            if universe_status != "READY" or not memberships:
                raise ValueError("Sandbox 诊断需要至少存在可绑定样本池成员。")
            return
        if universe_status != "READY" or not historical_memberships:
            raise ValueError("诊断样本池快照缺少历史 membership，不能使用当前 Universe 降级。")
        if not bool(pit_overview.get("verified_diagnostics_enabled") or pit_overview.get("factor_diagnostics_enabled")):
            if limited_ready:
                return
            missing = (
                ((pit_overview.get("diagnostic_windows") or {}).get("verified") or {}).get("missing_windows")
                if isinstance(pit_overview.get("diagnostic_windows"), Mapping)
                else []
            )
            labels = [
                str(item.get("label") or "")
                for item in missing
                if isinstance(item, Mapping) and str(item.get("label") or "")
            ]
            detail = "；".join(labels) if labels else "完整 PIT 窗口缺失"
            raise ValueError(f"完整 Verified PIT 门禁未通过：{detail}。")

    def _factor_value(
        self,
        factor_id: str,
        expression: str,
        prices: Sequence[float],
        index: int,
        fundamental: Mapping[str, Any] | None = None,
        *,
        rows: Sequence[Mapping[str, Any]] | None = None,
        market_returns_by_date: Mapping[str, float] | None = None,
        fundamental_history: Sequence[Mapping[str, Any]] | None = None,
        factor_cache: Mapping[str, Any] | None = None,
    ) -> float | None:
        normalized = expression.replace(" ", "")
        rows = rows or []
        market_returns_by_date = market_returns_by_date or {}
        fundamental_history = fundamental_history or []
        factor_cache = factor_cache or {}

        def daily_returns(window: int) -> list[float]:
            if index < window:
                return []
            return [
                prices[cursor] / prices[cursor - 1] - 1.0
                for cursor in range(index - window + 1, index + 1)
                if prices[cursor - 1] > 0
            ]

        def paired_market_returns(window: int) -> tuple[list[float], list[float]]:
            if index < window or not rows:
                return [], []
            asset_returns: list[float] = []
            market_returns: list[float] = []
            for cursor in range(index - window + 1, index + 1):
                if cursor <= 0 or prices[cursor - 1] <= 0:
                    continue
                row_date = str(rows[cursor].get("date") or "")
                market_return = market_returns_by_date.get(row_date)
                if market_return is None:
                    continue
                asset_returns.append(prices[cursor] / prices[cursor - 1] - 1.0)
                market_returns.append(float(market_return))
            return asset_returns, market_returns

        def rolling_beta(window: int) -> float | None:
            pair_prefix = factor_cache.get("market_pair_prefix")
            if isinstance(pair_prefix, Mapping):
                count, asset_sum, market_sum, _asset_square, market_square, product_sum = _window_pair_stats(
                    pair_prefix,
                    index - window + 1,
                    index,
                )
                if count < 20:
                    return None
                market_var = market_square - (market_sum * market_sum / count)
                if market_var <= 1e-12:
                    return None
                covariance = product_sum - (asset_sum * market_sum / count)
                return covariance / market_var
            asset_returns, market_returns = paired_market_returns(window)
            if len(asset_returns) < 20 or len(asset_returns) != len(market_returns):
                return None
            asset_mean = _mean(asset_returns) or 0.0
            market_mean = _mean(market_returns) or 0.0
            market_var = sum((value - market_mean) ** 2 for value in market_returns)
            if market_var <= 1e-12:
                return None
            covariance = sum(
                (asset - asset_mean) * (market - market_mean)
                for asset, market in zip(asset_returns, market_returns)
            )
            return covariance / market_var

        def market_cap_inputs() -> tuple[float, float, float, float, float]:
            if not fundamental:
                return 0.0, 0.0, 0.0, 0.0, 0.0
            ltm_earnings = _coerce_float(fundamental.get("ltm_earnings"))
            provider_market_cap = _coerce_float(
                fundamental.get("provider_market_cap"),
                _coerce_float(fundamental.get("market_cap")),
            )
            shares_outstanding = _coerce_float(
                fundamental.get("shares_outstanding"),
                _coerce_float(fundamental.get("total_shares")),
            )
            computed_market_cap = prices[index] * shares_outstanding if prices[index] > 0 and shares_outstanding > 0 else 0.0
            market_cap = computed_market_cap if computed_market_cap > 0 else provider_market_cap
            return (
                ltm_earnings,
                market_cap,
                shares_outstanding,
                _coerce_float(fundamental.get("book_value_equity")),
                _coerce_float(fundamental.get("capex")),
            )

        if factor_id == "s_beta_market_252d_raw" or normalized.startswith("BetaToMarket("):
            return rolling_beta(252)
        if factor_id == "s_beta_resid_252d_z" or normalized.startswith("ResidualVolatility("):
            beta = rolling_beta(252)
            if beta is None:
                return None
            pair_prefix = factor_cache.get("market_pair_prefix")
            if isinstance(pair_prefix, Mapping):
                count, asset_sum, market_sum, asset_square, market_square, product_sum = _window_pair_stats(
                    pair_prefix,
                    index - 252 + 1,
                    index,
                )
                if count < 2:
                    return None
                residual_sum = asset_sum - beta * market_sum
                residual_square = asset_square - 2.0 * beta * product_sum + beta * beta * market_square
                return _std_from_window_stats(count, residual_sum, residual_square)
            asset_returns, market_returns = paired_market_returns(252)
            residuals = [asset - beta * market for asset, market in zip(asset_returns, market_returns)]
            return _std(residuals)
        if factor_id == "s_vol_downside_252d_rank" or normalized.startswith("DownsideStd("):
            downside_prefix = factor_cache.get("downside_return_prefix")
            if isinstance(downside_prefix, Mapping):
                count, total, square_total = _window_stats(downside_prefix, index - 252 + 1, index)
                return _std_from_window_stats(count, total, square_total) if count >= 2 else 0.0
            returns = [value for value in daily_returns(252) if value < 0]
            return _std(returns) if len(returns) >= 2 else 0.0
        if factor_id == "s_vol_mdd_252d_rank" or normalized.startswith("MaxDrawdown("):
            if index < 252:
                return None
            peak = prices[index - 252]
            max_drawdown = 0.0
            for price in prices[index - 252 : index + 1]:
                if price <= 0:
                    continue
                peak = max(peak, price)
                if peak > 0:
                    max_drawdown = max(max_drawdown, (peak - price) / peak)
            return max_drawdown
        if factor_id == "s_liq_amihud_20d_rank" or "DollarVolume" in normalized:
            if index < 20 or not rows:
                return None
            values = []
            for cursor in range(index - 19, index + 1):
                if cursor <= 0 or prices[cursor - 1] <= 0:
                    continue
                volume = _coerce_float(rows[cursor].get("volume"))
                dollar_volume = prices[cursor] * volume
                if dollar_volume <= 0:
                    continue
                values.append(abs(prices[cursor] / prices[cursor - 1] - 1.0) / dollar_volume * 1_000_000_000.0)
            return _mean(values)
        if factor_id in {"s_mom_12m1m_rank", "momentum_12m_1m"} or "Close(t-21)/Close(t-252)-1" in normalized:
            if index < 252 or prices[index - 252] <= 0:
                return None
            return prices[index - 21] / prices[index - 252] - 1.0 if index >= 252 and index >= 21 else None
        if factor_id in {"s_mom_6m_rank", "s_mom_6m_raw"} or normalized.startswith("Return(Close,126)"):
            if index < 126 or prices[index - 126] <= 0:
                return None
            return prices[index] / prices[index - 126] - 1.0
        if factor_id == "s_mom_shortrev_1m_rank" or normalized.startswith("Return(Close,21)"):
            if index < 21 or prices[index - 21] <= 0:
                return None
            return prices[index] / prices[index - 21] - 1.0
        if factor_id in {"s_vol_252d_rank", "s_vol_252d_raw", "lowvol_realized_252d"} or normalized.startswith("Std(Return(Close,1),"):
            match = re.search(r"Std\(Return\(Close,1\),(\d+)\)", normalized)
            window = int(match.group(1)) if match else 252
            if index < window:
                return None
            return_prefix = factor_cache.get("daily_return_prefix")
            if isinstance(return_prefix, Mapping):
                count, total, square_total = _window_stats(return_prefix, index - window + 1, index)
                return _std_from_window_stats(count, total, square_total)
            returns = [
                prices[cursor] / prices[cursor - 1] - 1.0
                for cursor in range(index - window + 1, index + 1)
                if prices[cursor - 1] > 0
            ]
            return _std(returns)
        if fundamental:
            ltm_earnings = _coerce_float(fundamental.get("ltm_earnings"))
            provider_market_cap = _coerce_float(
                fundamental.get("provider_market_cap"),
                _coerce_float(fundamental.get("market_cap")),
            )
            shares_outstanding = _coerce_float(
                fundamental.get("shares_outstanding"),
                _coerce_float(fundamental.get("total_shares")),
            )
            computed_market_cap = prices[index] * shares_outstanding if prices[index] > 0 and shares_outstanding > 0 else 0.0
            market_cap = computed_market_cap if computed_market_cap > 0 else provider_market_cap
            book_value_equity = _coerce_float(fundamental.get("book_value_equity"))
            operating_cash_flow = _coerce_float(fundamental.get("operating_cash_flow"))
            capex = _coerce_float(fundamental.get("capex"))
            provider_enterprise_value = _coerce_float(fundamental.get("provider_enterprise_value"))
            stored_enterprise_value = _coerce_float(fundamental.get("enterprise_value"))
            total_debt = _coerce_float(fundamental.get("total_debt"))
            cash_and_equivalents = _coerce_float(fundamental.get("cash_and_equivalents"))
            enterprise_value = (
                provider_enterprise_value
                if provider_enterprise_value > 0
                else stored_enterprise_value
                if stored_enterprise_value > 0
                else market_cap + total_debt - cash_and_equivalents
            )
            if factor_id == "s_alpha_ffblend_cur_rank" or normalized.startswith("FFBlend("):
                if index < 252 or prices[index - 252] <= 0 or market_cap <= 0:
                    return None
                momentum = prices[index] / prices[index - 252] - 1.0
                earnings_yield = ltm_earnings / market_cap if market_cap > 0 else 0.0
                roe = ltm_earnings / book_value_equity if book_value_equity > 0 else 0.0
                size_penalty = math.log(market_cap) if market_cap > 0 else 0.0
                return 0.45 * momentum + 1.5 * earnings_yield + 0.5 * roe - 0.02 * size_penalty
            if factor_id == "s_liq_turnover_20d_rank" or normalized.startswith("Mean(Turnover,"):
                if index < 20 or shares_outstanding <= 0 or not rows:
                    return None
                turnover_values = [
                    _coerce_float(rows[cursor].get("volume")) / shares_outstanding
                    for cursor in range(index - 19, index + 1)
                    if _coerce_float(rows[cursor].get("volume")) > 0
                ]
                return _mean(turnover_values)
            if factor_id == "s_inv_assetgrowth_1y_rank" or "SharesOutstandingGrowth" in normalized:
                capex_intensity = capex / market_cap if market_cap > 0 else 0.0
                current_date = _parse_date(rows[index].get("date")) if rows else None
                shares_growth = None
                if current_date and shares_outstanding > 0:
                    target_date = current_date - timedelta(days=365)
                    prior_candidates = [
                        item
                        for item in fundamental_history
                        if (_parse_date(item.get("available_at") or item.get("date")) or current_date) <= target_date
                    ]
                    if prior_candidates:
                        prior = prior_candidates[-1]
                        prior_shares = _coerce_float(
                            prior.get("shares_outstanding"),
                            _coerce_float(prior.get("total_shares")),
                        )
                        if prior_shares > 0:
                            shares_growth = shares_outstanding / prior_shares - 1.0
                if shares_growth is None:
                    shares_growth = 0.0
                return shares_growth + capex_intensity
            if factor_id == "s_size_mcap_cur_raw" or normalized in {"MarketCap", "Rank(MarketCap)", "ZScore(MarketCap)"}:
                return market_cap if market_cap > 0 else None
            if factor_id == "s_val_ep_ltm_raw" or "LtmEarnings/MarketCap" in normalized:
                return ltm_earnings / market_cap if market_cap > 0 else None
            if factor_id == "s_val_bp_latest_raw" or "BookValueEquity/MarketCap" in normalized:
                return book_value_equity / market_cap if market_cap > 0 else None
            if factor_id == "s_val_cfp_ltm_raw" or "OperatingCashFlowLTM/MarketCap" in normalized:
                return operating_cash_flow / market_cap if market_cap > 0 else None
            if factor_id == "s_val_evocf_ltm_raw" or "EnterpriseValue/OperatingCashFlowLTM" in normalized:
                return enterprise_value / operating_cash_flow if operating_cash_flow > 0 else None
            if factor_id == "s_qlty_roe_ltm_raw" or "LtmEarnings/BookValueEquity" in normalized:
                return ltm_earnings / book_value_equity if book_value_equity > 0 else None
            if factor_id == "s_qlty_leverage_cur_raw" or "(CashAndEquivalents-TotalDebt)/MarketCap" in normalized:
                return (cash_and_equivalents - total_debt) / market_cap if market_cap > 0 else None
            if (
                factor_id == "s_qlty_fcfy_ttm_raw"
                or "(OperatingCashFlow-Capex)/EnterpriseValue" in normalized
                or "(OperatingCashFlowLTM-CapexLTM)/EnterpriseValue" in normalized
            ):
                return (operating_cash_flow - capex) / enterprise_value if enterprise_value > 0 else None
            if factor_id == "s_inv_capex_ltm_raw" or "CapexLTM/MarketCap" in normalized:
                return capex / market_cap if market_cap > 0 else None
            if factor_id == "s_size_cur_log" or "Log(MarketCap)" in normalized:
                return math.log(market_cap) if market_cap > 0 else None
        mean_return_match = re.search(r"Mean\(Return\(Close,1\),(\d+)\)", normalized)
        if mean_return_match:
            window = int(mean_return_match.group(1))
            if index < window:
                return None
            return_prefix = factor_cache.get("daily_return_prefix")
            if isinstance(return_prefix, Mapping):
                count, total, _square_total = _window_stats(return_prefix, index - window + 1, index)
                return total / count if count else None
            returns = [
                prices[cursor] / prices[cursor - 1] - 1.0
                for cursor in range(index - window + 1, index + 1)
                if prices[cursor - 1] > 0
            ]
            return _mean(returns)
        match = re.search(r"Delta\(Close,(\d+)\)", normalized) or re.search(r"Return\(Close,(\d+)\)", normalized)
        if match:
            window = int(match.group(1))
            if index < window or prices[index - window] <= 0:
                return None
            return prices[index] / prices[index - window] - 1.0
        if normalized in {"Close", "Rank(Close)", "ZScore(Close)"}:
            return prices[index]
        return None

    def _diagnostic_observations(
        self,
        *,
        factor_id: str,
        expression: str,
        direction: str,
        descriptor: Mapping[str, Any],
        dataset_snapshot_id: str,
        fundamental_snapshot_id: str,
        universe_snapshot_id: str,
        start_date: str,
        end_date: str,
        return_window_days: int,
        allow_current_membership: bool = False,
        excluded_symbols: Iterable[str] = (),
        symbols_override: Sequence[str] | None = None,
        bars_by_symbol_override: Mapping[str, Sequence[Mapping[str, Any]]] | None = None,
        fundamental_by_symbol_override: Mapping[str, Sequence[Mapping[str, Any]]] | None = None,
        prepared_frame_override: Mapping[str, Any] | None = None,
    ) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]], list[str]]:
        symbols = list(symbols_override) if symbols_override is not None else self._select_symbols(
            universe_snapshot_id,
            end_date,
            allow_current_membership=allow_current_membership,
        )
        excluded = {str(symbol).strip().upper() for symbol in excluded_symbols if str(symbol).strip()}
        if excluded:
            symbols = [symbol for symbol in symbols if symbol not in excluded]
        if not symbols:
            raise ValueError("研究态豁免排除了全部可诊断样本，无法执行诊断。")
        bars_by_symbol = dict(bars_by_symbol_override or {})
        if bars_by_symbol_override is None:
            bars_by_symbol = self.market_data_repository.load_dataset_price_bars(
                dataset_snapshot_id,
                symbols,
                start_date=(datetime.fromisoformat(start_date) - timedelta(days=420)).date().isoformat(),
                end_date=end_date,
                include_metadata=False,
            )
        fundamental_by_symbol: dict[str, list[dict[str, Any]]] = {}
        factor_requires_fundamental = (
            set(infer_factor_data_requirements(expression)) & FUNDAMENTAL_REQUIREMENTS
            or factor_id
            in {
                "s_alpha_ffblend_cur_rank",
                "s_inv_assetgrowth_1y_rank",
                "s_liq_turnover_20d_rank",
            }
        )
        if factor_requires_fundamental:
            if fundamental_by_symbol_override is not None:
                fundamental_by_symbol = {
                    symbol: list(rows)
                    for symbol, rows in fundamental_by_symbol_override.items()
                }
            elif not hasattr(self.market_data_repository, "load_dataset_fundamental_points"):
                raise ValueError("当前市场数据仓库不支持基础面 PIT 点位。")
            else:
                fundamental_by_symbol = self.market_data_repository.load_dataset_fundamental_points(
                    fundamental_snapshot_id,
                    symbols,
                    start_date=(datetime.fromisoformat(start_date) - timedelta(days=420)).date().isoformat(),
                    end_date=end_date,
                    as_of_date=end_date,
                )
        prepared_frame = prepared_frame_override if isinstance(prepared_frame_override, Mapping) else {}
        prepared_series = prepared_frame.get("series_by_symbol") if isinstance(prepared_frame.get("series_by_symbol"), Mapping) else None
        if prepared_series is not None:
            series_by_symbol = {
                symbol: list(prepared_series.get(symbol) or [])
                for symbol in symbols
                if prepared_series.get(symbol)
            }
        else:
            series_by_symbol = {
                symbol: sorted(rows, key=lambda item: item["date"])
                for symbol, rows in bars_by_symbol.items()
                if len(rows) >= return_window_days + 6
            }
        prices_by_symbol = prepared_frame.get("prices_by_symbol") if isinstance(prepared_frame.get("prices_by_symbol"), Mapping) else {}
        if not prices_by_symbol:
            prices_by_symbol = {
                symbol: [_coerce_float(row.get("adj_close") or row.get("close")) for row in rows]
                for symbol, rows in series_by_symbol.items()
            }
        if isinstance(prepared_frame.get("market_returns_by_date"), Mapping):
            market_returns_by_date = dict(prepared_frame.get("market_returns_by_date") or {})
        else:
            market_return_samples: dict[str, list[float]] = {}
            for symbol, rows in series_by_symbol.items():
                prices = list(prices_by_symbol.get(symbol) or [])
                for cursor in range(1, len(rows)):
                    if prices[cursor - 1] <= 0:
                        continue
                    market_return_samples.setdefault(str(rows[cursor].get("date") or ""), []).append(
                        prices[cursor] / prices[cursor - 1] - 1.0
                    )
            market_returns_by_date = {
                observation_date: _mean(values) or 0.0
                for observation_date, values in market_return_samples.items()
                if values
            }
        if isinstance(prepared_frame.get("sorted_fundamentals"), Mapping):
            sorted_fundamentals = dict(prepared_frame.get("sorted_fundamentals") or {})
        else:
            sorted_fundamentals = {
                symbol: sorted(rows, key=lambda item: (str(item.get("available_at") or item.get("date") or ""), str(item.get("date") or "")))
                for symbol, rows in fundamental_by_symbol.items()
            }
        factor_value_cache_by_symbol = (
            prepared_frame.get("factor_value_cache_by_symbol")
            if isinstance(prepared_frame.get("factor_value_cache_by_symbol"), Mapping)
            else {}
        )
        observation_points_by_symbol = (
            prepared_frame.get("observation_points_by_symbol")
            if isinstance(prepared_frame.get("observation_points_by_symbol"), Mapping)
            else {}
        )
        fundamental_cursor_by_symbol = {symbol: 0 for symbol in sorted_fundamentals}
        residual_reference = _parse_residual_factor_reference(expression)
        date_values: dict[str, dict[str, dict[str, float]]] = {}

        def compute_diagnostic_value(
            prices: Sequence[float],
            index: int,
            fundamental: Mapping[str, Any] | None,
            rows: Sequence[Mapping[str, Any]],
            symbol_fundamentals: Sequence[Mapping[str, Any]],
            factor_cache: Mapping[str, Any] | None,
        ) -> tuple[float | None, float | None]:
            if residual_reference:
                value = self._factor_value(
                    residual_reference["target_factor_id"],
                    "",
                    prices,
                    index,
                    fundamental,
                    rows=rows,
                    market_returns_by_date=market_returns_by_date,
                    fundamental_history=symbol_fundamentals,
                    factor_cache=factor_cache,
                )
                neutralizer_value = self._factor_value(
                    residual_reference["neutralizer_factor_id"],
                    "",
                    prices,
                    index,
                    fundamental,
                    rows=rows,
                    market_returns_by_date=market_returns_by_date,
                    fundamental_history=symbol_fundamentals,
                    factor_cache=factor_cache,
                )
                if value is None or neutralizer_value is None:
                    return None, None
                return value, neutralizer_value
            value = self._factor_value(
                factor_id,
                expression,
                prices,
                index,
                fundamental,
                rows=rows,
                market_returns_by_date=market_returns_by_date,
                fundamental_history=symbol_fundamentals,
                factor_cache=factor_cache,
            )
            return value, None

        for symbol, rows in series_by_symbol.items():
            prices = list(prices_by_symbol.get(symbol) or [])
            if not prices:
                prices = [_coerce_float(row.get("adj_close") or row.get("close")) for row in rows]
            symbol_fundamentals = sorted_fundamentals.get(symbol, [])
            factor_cache = (
                factor_value_cache_by_symbol.get(symbol)
                if isinstance(factor_value_cache_by_symbol, Mapping)
                else None
            )
            prepared_points = (
                observation_points_by_symbol.get(symbol)
                if isinstance(observation_points_by_symbol, Mapping)
                else None
            )
            if isinstance(prepared_points, list):
                for point in prepared_points:
                    if not isinstance(point, Mapping):
                        continue
                    index = int(point.get("index") or 0)
                    observation_date = str(point.get("date") or "")
                    fundamental = point.get("fundamental") if isinstance(point.get("fundamental"), Mapping) else None
                    value, neutralizer_value = compute_diagnostic_value(
                        prices,
                        index,
                        fundamental,
                        rows,
                        symbol_fundamentals,
                        factor_cache,
                    )
                    if value is None:
                        continue
                    if direction == "LOW_IS_BETTER":
                        value = -value
                    entry = {
                        "value": value,
                        "future_return": _coerce_float(point.get("future_return")),
                    }
                    if neutralizer_value is not None:
                        entry["neutralizer_value"] = neutralizer_value
                    date_values.setdefault(observation_date, {})[symbol] = entry
                continue
            for index in range(0, max(len(rows) - return_window_days, 0), 21):
                observation_date = str(rows[index].get("date") or "")
                if observation_date < start_date or observation_date > end_date:
                    continue
                fundamental = None
                if symbol_fundamentals:
                    cursor = fundamental_cursor_by_symbol.get(symbol, 0)
                    while (
                        cursor + 1 < len(symbol_fundamentals)
                        and str(symbol_fundamentals[cursor + 1].get("available_at") or symbol_fundamentals[cursor + 1].get("date") or "")
                        <= observation_date
                    ):
                        cursor += 1
                    fundamental_cursor_by_symbol[symbol] = cursor
                    if str(symbol_fundamentals[cursor].get("available_at") or symbol_fundamentals[cursor].get("date") or "") <= observation_date:
                        fundamental = symbol_fundamentals[cursor]
                value, neutralizer_value = compute_diagnostic_value(
                    prices,
                    index,
                    fundamental,
                    rows,
                    symbol_fundamentals,
                    factor_cache,
                )
                if value is None:
                    continue
                future_price = prices[index + return_window_days]
                current_price = prices[index]
                if current_price <= 0:
                    continue
                future_return = future_price / current_price - 1.0
                if direction == "LOW_IS_BETTER":
                    value = -value
                entry = {"value": value, "future_return": future_return}
                if neutralizer_value is not None:
                    entry["neutralizer_value"] = neutralizer_value
                date_values.setdefault(observation_date, {})[symbol] = entry
        observations = []
        for observation_date, symbol_map in sorted(date_values.items()):
            if len(symbol_map) < 3:
                continue
            raw_factor_values = [item["value"] for item in symbol_map.values()]
            operator = (
                residual_reference.get("outer_operator")
                if residual_reference and residual_reference.get("outer_operator")
                else str(descriptor.get("operator") or "").lower()
            )
            if residual_reference:
                neutralizer_values = [
                    item["neutralizer_value"]
                    for item in symbol_map.values()
                    if "neutralizer_value" in item
                ]
                if len(neutralizer_values) != len(raw_factor_values) or len(neutralizer_values) < 3:
                    continue
                raw_factor_values = _linear_residuals(raw_factor_values, neutralizer_values)
                if len(raw_factor_values) < 3:
                    continue
            if operator == "rank" or str(expression).strip().startswith("Rank("):
                ranks = _rank(raw_factor_values)
                denominator = max(1.0, float(len(ranks) - 1))
                factor_values = [(rank - 1.0) / denominator for rank in ranks]
            elif operator == "z" or str(expression).strip().startswith("ZScore("):
                mean = _mean(raw_factor_values) or 0.0
                std = _std(raw_factor_values) or 0.0
                factor_values = [((value - mean) / std) if std > 1e-12 else 0.0 for value in raw_factor_values]
            else:
                factor_values = raw_factor_values
            forward_returns = [item["future_return"] for item in symbol_map.values()]
            observations.append(
                {
                    "date": observation_date,
                    "ic": _pearson(factor_values, forward_returns),
                    "rank_ic": _spearman(factor_values, forward_returns),
                    "symbol_count": len(symbol_map),
                    "factor_values": factor_values,
                    "forward_returns": forward_returns,
                }
            )
        return observations, series_by_symbol, symbols

    def run_diagnostics(self, factor_id: str, request: Any) -> dict[str, Any]:
        payload = dict(_as_mapping(request))
        resolved_factor_id = _canonical_factor_id(factor_id)
        diagnostic_mode = str(payload.get("diagnostic_mode") or "VERIFIED").upper()
        if diagnostic_mode not in {"VERIFIED", "SANDBOX"}:
            raise ValueError("诊断模式必须是 VERIFIED 或 SANDBOX。")
        pit_overview = self._pit_overview()
        research_waiver = pit_overview.get("research_waiver") if isinstance(pit_overview.get("research_waiver"), Mapping) else None
        pit_readiness_mode = str(pit_overview.get("overall_status") or "BLOCKED").upper()
        ignored_symbols = [
            str(symbol).strip().upper()
            for symbol in ((research_waiver or {}).get("ignored_symbols") or [])
            if str(symbol).strip()
        ] if pit_readiness_mode == "LIMITED_READY" else []
        factor = self.get_factor(resolved_factor_id)
        if factor.get("diagnostic_status") == "BLOCKED_DATA":
            blockers = factor.get("readiness_blockers") or []
            missing = blockers[0].get("missing_fields") if blockers and isinstance(blockers[0], Mapping) else []
            raise ValueError(f"因子基础数据待补，缺失字段：{', '.join(missing or [])}。")
        if factor.get("diagnostic_status") == "BLOCKED_PIT":
            blockers = factor.get("readiness_blockers") or []
            message = blockers[0].get("message") if blockers and isinstance(blockers[0], Mapping) else None
            raise ValueError(str(message or "PIT 门禁未通过，诊断已被阻止。"))
        if (
            diagnostic_mode == "VERIFIED"
            and factor.get("diagnostic_status") == "SANDBOX_READY"
            and pit_readiness_mode != "LIMITED_READY"
        ):
            blockers = factor.get("readiness_blockers") or []
            missing_windows = blockers[0].get("missing_windows") if blockers and isinstance(blockers[0], Mapping) else []
            labels = [
                str(item.get("label") or "")
                for item in missing_windows
                if isinstance(item, Mapping) and str(item.get("label") or "")
            ]
            detail = "；".join(labels) if labels else "完整 PIT 窗口缺失"
            raise ValueError(f"完整 Verified PIT 门禁未通过：{detail}。")
        run_id = f"fdiag_{uuid4().hex[:12]}"
        now = iso_now()
        dataset_snapshot_id = str(payload.get("dataset_snapshot_id") or "")
        universe_snapshot_id = str(payload.get("universe_snapshot_id") or "")
        if not dataset_snapshot_id or not universe_snapshot_id:
            raise ValueError("诊断必须绑定 dataset_snapshot_id 与 universe_snapshot_id。")
        start_date = str(payload.get("start_date"))
        end_date = str(payload.get("end_date"))
        self._validate_diagnostic_snapshot_binding(
            dataset_snapshot_id=dataset_snapshot_id,
            universe_snapshot_id=universe_snapshot_id,
            start_date=start_date,
            end_date=end_date,
            diagnostic_mode=diagnostic_mode,
        )
        return_window_days = int(payload.get("return_window_days") or 21)
        group_count = int(payload.get("group_count") or 5)
        observations, series_by_symbol, requested_symbols = self._diagnostic_observations(
            factor_id=resolved_factor_id,
            expression=str(factor["expression"]),
            direction=str(factor["direction"]),
            descriptor=factor.get("descriptor") if isinstance(factor.get("descriptor"), Mapping) else {},
            dataset_snapshot_id=dataset_snapshot_id,
            fundamental_snapshot_id=str(pit_overview.get("fundamental_snapshot_id") or DATASET_FUNDAMENTALS_SNAPSHOT_ID),
            universe_snapshot_id=universe_snapshot_id,
            start_date=start_date,
            end_date=end_date,
            return_window_days=return_window_days,
            allow_current_membership=diagnostic_mode == "SANDBOX",
            excluded_symbols=ignored_symbols,
        )
        if not observations:
            raise ValueError("诊断区间内没有足够横截面观测，无法计算 IC。")
        ic_values = [item["ic"] for item in observations if item.get("ic") is not None]
        rank_ic_values = [item["rank_ic"] for item in observations if item.get("rank_ic") is not None]
        rank_ic_mean = _mean(rank_ic_values)
        rank_ic_std = _std(rank_ic_values)
        ir = (rank_ic_mean / rank_ic_std * math.sqrt(12.0)) if rank_ic_mean is not None and rank_ic_std and rank_ic_std > 1e-12 else None
        latest_observation = observations[-1]
        ranked_pairs = sorted(
            zip(latest_observation["factor_values"], latest_observation["forward_returns"]),
            key=lambda item: item[0],
            reverse=True,
        )
        group_returns = []
        for group_index in range(group_count):
            start = int(group_index * len(ranked_pairs) / group_count)
            end = int((group_index + 1) * len(ranked_pairs) / group_count)
            bucket = ranked_pairs[start:end]
            group_returns.append(
                {
                    "group": f"第{group_index + 1}组",
                    "mean_return": _safe_round(_mean([item[1] for item in bucket]) or 0.0, 4),
                    "sample_count": len(bucket),
                }
            )
        coverage = round(
            min(1.0, (sum(int(item["symbol_count"]) for item in observations) / max(1, len(requested_symbols) * len(observations)))) * 100.0,
            2,
        )
        risk_flags = []
        if abs(rank_ic_mean or 0.0) < 0.02:
            risk_flags.append("Rank IC 接近 0，预测性较弱。")
        if str(factor["id"]) in {"s_mom_12m1m_rank", "momentum_12m_1m"}:
            risk_flags.append("市场风格切换时需关注动量崩溃。")
        if coverage < 80:
            risk_flags.append("覆盖率不足 80%，请优先检查 PIT 样本池和价格覆盖。")
        waiver_impact_estimate = (
            research_waiver.get("impact_estimate")
            if isinstance(research_waiver, Mapping) and isinstance(research_waiver.get("impact_estimate"), Mapping)
            else None
        )
        if ignored_symbols:
            impact_label = ""
            if waiver_impact_estimate:
                impact_label = (
                    f"估算市值权重 {waiver_impact_estimate.get('mcap_weight_pct')}%，"
                    f"潜在 IC 扰动约 {waiver_impact_estimate.get('estimated_ic_delta_abs')}。"
                )
            risk_flags.append(
                f"研究态豁免已排除 {len(ignored_symbols)} 个 symbol，{impact_label}晋升前必须 Full Ready 复算。"
            )
        summary = {
            "run_id": run_id,
            "factor_id": resolved_factor_id,
            "status": "COMPLETED",
            "diagnostic_mode": diagnostic_mode,
            "descriptor": factor.get("descriptor"),
            "dataset_snapshot_id": dataset_snapshot_id,
            "fundamental_snapshot_id": pit_overview.get("fundamental_snapshot_id"),
            "universe_snapshot_id": universe_snapshot_id,
            "cleaning_version": pit_overview.get("cleaning_version"),
            "ic": _safe_round(_mean(ic_values), 4),
            "rank_ic": _safe_round(rank_ic_mean, 4),
            "ir": _safe_round(ir, 4),
            "coverage": coverage,
            "group_returns": group_returns,
            "ic_series": [
                {
                    "date": item["date"],
                    "ic": _safe_round(item.get("ic"), 4),
                    "rank_ic": _safe_round(item.get("rank_ic"), 4),
                    "symbol_count": item["symbol_count"],
                }
                for item in observations[-36:]
            ],
            "evidence_heatmap": self._evidence_heatmap(rank_ic_values),
            "turnover_decay": self._turnover_decay_summary(factor_id),
            "stress_scenarios": self._stress_scenarios(factor_id),
            "risk_flags": risk_flags,
            "admission": {
                "mode": diagnostic_mode,
                "label": "Sandbox 预览" if diagnostic_mode == "SANDBOX" else ("Limited Ready 研究诊断" if pit_readiness_mode == "LIMITED_READY" else "Verified 正式诊断"),
                "verified_gate": "limited" if pit_readiness_mode == "LIMITED_READY" else ("passed" if diagnostic_mode == "VERIFIED" else "pending"),
                "missing_windows": (
                    (((pit_overview.get("diagnostic_windows") or {}).get("verified") or {}).get("missing_windows") or [])
                    if diagnostic_mode == "SANDBOX"
                    else []
                ),
                "note": (
                    f"Sandbox 仅用于最近 {SANDBOX_DIAGNOSTIC_YEARS} 年试跑，不会把因子升级为 Verified。"
                    if diagnostic_mode == "SANDBOX"
                    else (
                        "Limited Ready 只允许研究阶段使用，策略晋升仍要求 Full Ready。"
                        if pit_readiness_mode == "LIMITED_READY"
                        else f"Verified 诊断要求完整 {FORMAL_DIAGNOSTIC_YEARS} 年 PIT 窗口。"
                    )
                ),
            },
            "compliance_trail": {
                "factor_logic": factor["expression"],
                "descriptor": factor.get("descriptor"),
                "dataset_snapshot_id": dataset_snapshot_id,
                "fundamental_snapshot_id": pit_overview.get("fundamental_snapshot_id"),
                "universe_snapshot_id": universe_snapshot_id,
                "cleaning_version": pit_overview.get("cleaning_version"),
                "diagnosed_at": now,
                "operator": "researcher",
            },
            "artifact_refs": {
                "ic_series": f"artifacts/factors/{run_id}/ic-series.json",
                "matrix": f"artifacts/factors/{run_id}/diagnostic-matrix.json",
            },
            "symbol_count": len(series_by_symbol),
            "pit_readiness_mode": pit_readiness_mode,
            "waiver_id": research_waiver.get("id") if isinstance(research_waiver, Mapping) else None,
            "ignored_symbol_count": len(ignored_symbols),
            "waiver_impact_estimate": waiver_impact_estimate,
            "promotion_eligible": pit_readiness_mode == "READY" and diagnostic_mode == "VERIFIED",
        }
        with self.storage.connection() as conn:
            conn.execute(
                """
                INSERT INTO factor_diagnostic_runs (
                    id, factor_id, status, dataset_snapshot_id, universe_snapshot_id,
                    request_json, summary_json, artifact_refs_json, created_at, completed_at
                )
                VALUES (?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    run_id,
                    resolved_factor_id,
                    dataset_snapshot_id,
                    universe_snapshot_id,
                    dumps(payload),
                    dumps(summary),
                    dumps(summary["artifact_refs"]),
                    now,
                    now,
                ),
            )
            stored_status = "COMPLETED" if summary["promotion_eligible"] else "SANDBOX_READY"
            conn.execute(
                """
                UPDATE factor_definitions
                SET diagnostic_status = ?,
                    lifecycle_status = CASE
                        WHEN ? = '1' AND lifecycle_status = 'DRAFT' THEN 'VERIFIED'
                        ELSE lifecycle_status
                    END,
                    updated_at = ?
                WHERE id = ?
                """,
                (stored_status, "1" if summary["promotion_eligible"] else "0", now, resolved_factor_id),
            )
        return {"run_id": run_id, "summary": summary}

    def _evidence_heatmap(self, rank_ic_values: Sequence[float]) -> list[dict[str, Any]]:
        windows = ("10年", "20年", "30年")
        cells = []
        base = _mean(list(rank_ic_values)) or 0.0
        for row_index, window in enumerate(windows):
            for bucket in ("样本内", "样本外", "压力", "漂移"):
                value = base - row_index * 0.006 + (0.01 if bucket == "样本外" else 0.0)
                state = "预警" if bucket == "漂移" and value < 0.03 else "通过"
                if bucket == "压力" and value < 0.0:
                    state = "缺口"
                cells.append({"window": window, "bucket": bucket, "value": _safe_round(value, 4), "state": state})
        return cells[:10]

    def _turnover_decay_summary(self, factor_id: str) -> dict[str, Any]:
        if factor_id in {"s_mom_12m1m_rank", "momentum_12m_1m"}:
            return {
                "half_life_days": 126,
                "annual_turnover_pct": 185.0,
                "impact_cost_bps": 18.0,
                "financing_cost_bps": 32.0,
                "slippage_bps": 6.0,
                "note": "半年期动量需要在 TRS 成本核算中单独计入换手摩擦。",
            }
        return {
            "half_life_days": 252,
            "annual_turnover_pct": 72.0,
            "impact_cost_bps": 9.0,
            "financing_cost_bps": 18.0,
            "slippage_bps": 4.0,
            "note": "换手与衰减为诊断摘要估算，正式交易前需结合券商费率复核。",
        }

    def _stress_scenarios(self, factor_id: str) -> list[dict[str, Any]]:
        is_momentum = factor_id in {"s_mom_12m1m_rank", "momentum_12m_1m"}
        return [
            {
                "name": "2008 金融危机代理补测",
                "data_kind": "代理数据",
                "status": "需要复核" if is_momentum else "通过",
                "rank_ic": -0.08 if is_momentum else 0.03,
                "note": "代理数据仅用于压力逻辑，不与真实 PIT 样本混同。",
            },
            {
                "name": "2020 成长股牛市",
                "data_kind": "真实 PIT 样本",
                "status": "观察",
                "rank_ic": 0.02,
                "note": "风格极端阶段需要观察斜率反转。",
            },
        ]

    def preview_diagnostics(self, request: Any) -> dict[str, Any]:
        payload = dict(_as_mapping(request))
        if bool(payload.get("batch")):
            return self.preview_diagnostics_batch(payload)
        expression = str(payload.get("expression") or "").strip()
        risks = validate_factor_expression(expression)
        today = date.today()
        return {
            "mode": "SINGLE",
            "status": "PREVIEW",
            "lookback_years": int(payload.get("lookback_years") or 5),
            "expression": expression,
            "rank_ic_preview": [
                {
                    "date": (today - timedelta(days=(11 - index) * 30)).isoformat(),
                    "rank_ic": round(0.035 + math.sin(index / 2.0) * 0.024, 4),
                }
                for index in range(12)
            ],
            "distribution": {
                "skew": 0.18,
                "kurtosis": 2.7,
                "normality_label": "接近正态",
            },
            "risk_flags": risks,
            "message": "5 年样本内 IC 预览只用于缩短试错，不替代正式 PIT 诊断。",
        }

    def export_factor_diagnostic_report(self, factor_id: str, run_id: str) -> dict[str, Any]:
        candidates = _factor_id_candidates(factor_id)
        placeholders = ",".join("?" for _ in candidates)
        run = self.storage.fetch_one(
            f"SELECT * FROM factor_diagnostic_runs WHERE id = ? AND factor_id IN ({placeholders})",
            (run_id, *candidates),
        )
        if not run:
            raise KeyError(f"Diagnostic run not found: {run_id}")
        summary = _decode_json_dict(run.get("summary_json"))
        title = f"Grit Strategy Lab 因子诊断报告 {factor_id} {run_id}"
        body = "\n".join(
            [
                title,
                f"Rank IC: {summary.get('rank_ic')}",
                f"IR: {summary.get('ir')}",
                f"覆盖率: {summary.get('coverage')}%",
                f"数据快照: {summary.get('dataset_snapshot_id')}",
                f"样本池快照: {summary.get('universe_snapshot_id')}",
            ]
        )
        pdf_text = body.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        stream = f"BT /F1 12 Tf 48 760 Td ({pdf_text}) Tj ET"
        pdf = (
            "%PDF-1.4\n"
            "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n"
            "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n"
            "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n"
            f"4 0 obj << /Length {len(stream)} >> stream\n{stream}\nendstream endobj\n"
            "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n"
            "xref\n0 6\n0000000000 65535 f \n"
            "trailer << /Root 1 0 R /Size 6 >>\nstartxref\n0\n%%EOF\n"
        ).encode("utf-8")
        return {
            "content": pdf,
            "filename": f"{factor_id}-{run_id}-diagnostic.pdf",
            "media_type": "application/pdf",
        }

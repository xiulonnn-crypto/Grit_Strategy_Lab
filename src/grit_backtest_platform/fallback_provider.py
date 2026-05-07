from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Protocol


PUBLIC_PROVIDER_NAMES = {
    "yahoo",
    "yfinance",
    "akshare_us",
    "stooq",
    "github_sp500_historical_components",
    "wikipedia_revision_history",
    "wikipedia_sp500_changes_table",
    "wikipedia_nasdaq100_changes_table",
    "github_sp500_current_dataset",
    "nasdaq_official_annual_changes",
    "sp_global_official_constituent_change",
    "internet_archive_wikipedia_snapshot",
    "static_seed",
    "us_treasury_xml",
    "us_treasury_bill_proxy",
    "us_treasury_cmt_proxy",
    "us_treasury_tips_proxy",
    "blackrock_ishares_official",
    "ishares",
    "openbb_yfinance",
    "openbb_federal_reserve",
    "openbb_bond_fixed_income",
}

FREE_ACCOUNT_PROVIDER_NAMES = {
    "alpha_vantage",
    "sec_edgar",
    "tiingo",
    "tiingo_symbology",
    "nasdaq_wiki",
    "finnhub",
    "fmp",
    "fmp_historical_constituent",
    "openbb_tiingo",
    "openbb_alpha_vantage",
    "openbb_fred",
    "kaggle_huge_stock_market_dataset",
    "kaggle_delisted_bulk_archive",
}

PAID_OPTIONAL_PROVIDER_NAMES = {
    "longbridge",
    "longbridge_static_info",
    "futu",
    "futu_rehab",
    "openbb_fmp",
    "openbb_index_constituents",
    "polygon",
}


@dataclass(frozen=True)
class ProviderAvailability:
    provider_name: str
    available: bool
    reason: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


class ProviderExecutionSignal(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        status: str,
        reason: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = str(status or "failed").strip().lower()
        self.reason = str(reason or message).strip()
        self.metadata = dict(metadata or {})


def provider_access_tier(provider_or_name: Any) -> str:
    metadata = getattr(provider_or_name, "metadata", None)
    if isinstance(metadata, dict):
        explicit = str(metadata.get("access_tier") or "").strip().lower()
        if explicit in {"public", "free_account", "paid_optional"}:
            return explicit
    if not isinstance(provider_or_name, str):
        availability = getattr(provider_or_name, "availability", None)
        if callable(availability):
            try:
                report = availability()
            except Exception:
                report = None
            explicit = str(getattr(report, "metadata", {}).get("access_tier") or "").strip().lower() if report else ""
            if explicit in {"public", "free_account", "paid_optional"}:
                return explicit
        provider_name = str(getattr(provider_or_name, "provider_name", provider_or_name.__class__.__name__)).strip().lower()
    else:
        provider_name = str(provider_or_name or "").strip().lower()
    if provider_name in FREE_ACCOUNT_PROVIDER_NAMES:
        return "free_account"
    if provider_name in PAID_OPTIONAL_PROVIDER_NAMES:
        return "paid_optional"
    return "public"


class SecondaryMarketDataProvider(Protocol):
    provider_name: str

    def availability(self) -> ProviderAvailability: ...

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> Any: ...


class SecondaryUniverseHistoryProvider(Protocol):
    provider_name: str

    def availability(self) -> ProviderAvailability: ...

    def load_snapshots(self, start_date: date, end_date: date) -> list[Any]: ...


class UnconfiguredFallbackProvider:
    provider_name = "fallback_unavailable"

    def __init__(self, reason: str = "No secondary provider configured.") -> None:
        self.reason = reason

    def availability(self) -> ProviderAvailability:
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=False,
            reason=self.reason,
            metadata={"mode": "unconfigured"},
        )

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> Any:
        raise RuntimeError(f"{self.provider_name}: {self.reason}")

    def load_snapshots(self, start_date: date, end_date: date) -> list[Any]:
        raise RuntimeError(f"{self.provider_name}: {self.reason}")


class SequentialMarketDataProviderChain:
    provider_name = "sequential_market_data_chain"

    def __init__(self, *providers: Any) -> None:
        self.providers = [provider for provider in providers if provider is not None]
        self.fallback_provider = self.providers[1] if len(self.providers) > 1 else None

    def availability(self) -> ProviderAvailability:
        if not self.providers:
            return ProviderAvailability(
                provider_name=self.provider_name,
                available=False,
                reason="No market-data providers configured.",
                metadata={"providers": []},
            )
        reports: list[ProviderAvailability] = []
        for provider in self.providers:
            if not hasattr(provider, "availability"):
                continue
            report = provider.availability()
            reports.append(report)
            if report.available:
                return ProviderAvailability(
                    provider_name=self.provider_name,
                    available=True,
                    reason=report.reason,
                    metadata={
                        "selected_provider": report.provider_name,
                        "providers": [item.provider_name for item in reports],
                    },
                )
        fallback_report = reports[0] if reports else None
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=False,
            reason=fallback_report.reason if fallback_report else "No provider reported availability.",
            metadata={
                "providers": [item.provider_name for item in reports],
                "reasons": [
                    {
                        "provider": item.provider_name,
                        "available": item.available,
                        "reason": item.reason,
                    }
                    for item in reports
                ],
            },
        )

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> Any:
        errors: list[str] = []
        for provider in self.providers:
            fetch_history = getattr(provider, "fetch_history", None)
            if fetch_history is None:
                continue
            try:
                return fetch_history(symbol, start_date, end_date)
            except Exception as exc:
                errors.append(f"{getattr(provider, 'provider_name', provider.__class__.__name__)}: {exc}")
        raise RuntimeError(
            f"{self.provider_name}: no provider returned market data for {symbol}. "
            + ("; ".join(errors) if errors else "No providers were configured.")
        )

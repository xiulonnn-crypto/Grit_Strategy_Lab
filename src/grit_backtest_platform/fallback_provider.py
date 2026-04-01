from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Protocol


@dataclass(frozen=True)
class ProviderAvailability:
    provider_name: str
    available: bool
    reason: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


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

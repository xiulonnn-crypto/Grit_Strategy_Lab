from __future__ import annotations

import gzip
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from typing import Any

from .fallback_provider import ProviderAvailability


SEC_COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
REPORT_FORMS = {"10-K", "10-Q", "8-K", "20-F", "6-K"}
_EMAIL_PATTERN = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")


def _parse_iso_date(value: Any) -> str | None:
    text = str(value or "").strip()
    return text[:10] if text else None


def _extract_email(value: str) -> str:
    match = _EMAIL_PATTERN.search(str(value or "").strip())
    return match.group(0) if match else ""


def _build_formal_user_agent(raw_user_agent: str, contact_email: str, contact_name: str) -> str:
    base = str(raw_user_agent or "").strip()
    email = _extract_email(contact_email) or _extract_email(base)
    if not base and contact_name and email:
        return f"{contact_name} ({email})"
    if base and email and email not in base:
        return f"{base} ({email})"
    return base


class SecEdgarProvider:
    provider_name = "sec_edgar"

    def __init__(self, user_agent: str | None = None, timeout: int = 20) -> None:
        raw_user_agent = str(user_agent or os.getenv("SEC_USER_AGENT") or "").strip()
        self.contact_email = _extract_email(
            str(os.getenv("SEC_CONTACT_EMAIL") or os.getenv("SEC_EDGAR_CONTACT_EMAIL") or "").strip()
        )
        self.contact_name = str(
            os.getenv("SEC_CONTACT_NAME") or os.getenv("SEC_EDGAR_CONTACT_NAME") or "TradeAdmin Grit_Strategy_Lab"
        ).strip()
        self.user_agent = _build_formal_user_agent(raw_user_agent, self.contact_email, self.contact_name)
        self.timeout = timeout
        self._ticker_cache: dict[str, dict[str, Any]] | None = None

    def availability(self) -> ProviderAvailability:
        return ProviderAvailability(
            provider_name=self.provider_name,
            available=bool(self.user_agent and _extract_email(self.user_agent)),
            reason=(
                None
                if self.user_agent and _extract_email(self.user_agent)
                else "SEC_USER_AGENT must include a contact email."
            ),
            metadata={"requires_user_agent": True, "requires_contact_email": True},
        )

    def _request_json(self, url: str) -> Any:
        if not self.user_agent:
            raise RuntimeError("SEC_USER_AGENT is not configured.")
        if not _extract_email(self.user_agent):
            raise RuntimeError("SEC_USER_AGENT must include a contact email.")
        headers = {
            "User-Agent": self.user_agent,
            "Accept": "application/json",
            "Accept-Encoding": "gzip, deflate",
            "Accept-Language": "en-US,en;q=0.9",
            "Connection": "keep-alive",
        }
        contact_email = self.contact_email or _extract_email(self.user_agent)
        if contact_email:
            headers["From"] = contact_email
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = response.read()
                encoding = str(getattr(response, "headers", {}).get("Content-Encoding", "") or "").lower()
                if encoding == "gzip" or payload[:2] == b"\x1f\x8b":
                    payload = gzip.decompress(payload)
                return json.loads(payload.decode("utf-8"))
        except urllib.error.URLError as exc:
            raise RuntimeError(f"SEC request failed: {exc}") from exc

    def _load_ticker_index(self) -> dict[str, dict[str, Any]]:
        if self._ticker_cache is not None:
            return self._ticker_cache
        payload = self._request_json(SEC_COMPANY_TICKERS_URL)
        cache: dict[str, dict[str, Any]] = {}
        if isinstance(payload, dict):
            values = payload.values()
        elif isinstance(payload, list):
            values = payload
        else:
            values = []
        for entry in values:
            if not isinstance(entry, dict):
                continue
            ticker = str(entry.get("ticker") or "").upper()
            if not ticker:
                continue
            cik = str(entry.get("cik_str") or entry.get("cik") or "").strip()
            cache[ticker] = {
                "symbol": ticker,
                "canonical_symbol": ticker,
                "company_name": str(entry.get("title") or entry.get("name") or ""),
                "cik": cik.zfill(10) if cik.isdigit() else cik,
                "exchange": str(entry.get("exchange") or ""),
                "ipo_date": entry.get("ipoDate") or entry.get("ipo_date"),
                "delisting_date": entry.get("delistingDate") or entry.get("delisting_date"),
                "source": self.provider_name,
                "valid_from": None,
                "valid_to": None,
            }
        self._ticker_cache = cache
        return cache

    def resolve_identity(self, symbol: str) -> dict[str, Any] | None:
        return self._load_ticker_index().get(symbol.upper())

    def resolve_identities(self, symbols: list[str] | tuple[str, ...] | set[str]) -> dict[str, dict[str, Any]]:
        requested = {
            str(symbol).strip().upper()
            for symbol in symbols
            if str(symbol).strip()
        }
        if not requested:
            return {}
        ticker_index = self._load_ticker_index()
        return {
            symbol: dict(ticker_index[symbol])
            for symbol in sorted(requested)
            if symbol in ticker_index
        }

    def fetch_report_filings(self, symbol: str, start_date: date, end_date: date) -> list[dict[str, Any]]:
        identity = self.resolve_identity(symbol)
        if not identity or not identity.get("cik"):
            raise RuntimeError(f"No SEC identity mapping available for {symbol}.")
        cik = str(identity["cik"]).zfill(10)
        payload = self._request_json(SEC_SUBMISSIONS_URL.format(cik=cik))
        filings = ((payload or {}).get("filings") or {}).get("recent") or {}
        dates = filings.get("filingDate") or []
        forms = filings.get("form") or []
        accession_numbers = filings.get("accessionNumber") or []
        primary_documents = filings.get("primaryDocument") or []

        actions: list[dict[str, Any]] = []
        for index, filing_date in enumerate(dates):
            if index >= len(forms):
                continue
            form = str(forms[index] or "").strip().upper()
            if form not in REPORT_FORMS:
                continue
            normalized_date = _parse_iso_date(filing_date)
            if not normalized_date:
                continue
            if normalized_date < start_date.isoformat() or normalized_date > end_date.isoformat():
                continue
            actions.append(
                {
                    "date": normalized_date,
                    "action_type": "report_filed",
                    "value": None,
                    "source": self.provider_name,
                    "payload": {
                        "form": form,
                        "accession_number": accession_numbers[index] if index < len(accession_numbers) else None,
                        "primary_document": primary_documents[index] if index < len(primary_documents) else None,
                        "cik": cik,
                        "company_name": identity.get("company_name"),
                    },
                }
            )
        return actions

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> Any:
        raise RuntimeError(
            "SEC EDGAR does not provide daily price bars in this slice; use Tiingo or FMP for price history."
        )


SecEdgarEventProvider = SecEdgarProvider

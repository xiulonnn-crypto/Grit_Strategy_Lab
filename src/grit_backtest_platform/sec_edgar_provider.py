from __future__ import annotations

import gzip
import html
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from typing import Any, Mapping

from .fallback_provider import ProviderAvailability


SEC_COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_BROWSE_EDGAR_URL = "https://www.sec.gov/cgi-bin/browse-edgar"
SEC_SEARCH_INDEX_URL = "https://efts.sec.gov/LATEST/search-index"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
SEC_COMPANYFACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
REPORT_FORMS = {"10-K", "10-Q", "8-K", "20-F", "6-K"}
FUNDAMENTAL_REPORT_FORMS = {"10-K", "10-Q", "20-F", "40-F"}
_EMAIL_PATTERN = re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}")

SEC_FUNDAMENTAL_FACT_TAGS: dict[str, tuple[str, ...]] = {
    "revenue": (
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
    ),
    "gross_profit": ("GrossProfit",),
    "net_income": ("NetIncomeLoss",),
    "book_value_equity": ("StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
    "operating_cash_flow": ("NetCashProvidedByUsedInOperatingActivities",),
    "capex": ("PaymentsToAcquirePropertyPlantAndEquipment",),
    "total_shares": ("WeightedAverageNumberOfDilutedSharesOutstanding", "WeightedAverageNumberOfSharesOutstandingBasic"),
    "shares_outstanding": ("EntityCommonStockSharesOutstanding",),
    "total_assets": ("Assets",),
    "current_assets": ("AssetsCurrent",),
    "current_liabilities": ("LiabilitiesCurrent",),
    "long_term_debt": (
        "LongTermDebtNoncurrent",
        "LongTermDebtAndFinanceLeaseObligationsNoncurrent",
        "LongTermDebt",
    ),
    "total_debt": (
        "DebtAndFinanceLeaseObligations",
        "LongTermDebtAndFinanceLeaseObligationsCurrentAndNoncurrent",
        "LongTermDebt",
    ),
    "cash_and_equivalents": (
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ),
}

SEC_IFRS_FUNDAMENTAL_FACT_TAGS: dict[str, tuple[str, ...]] = {
    "revenue": ("Revenue", "RevenueFromContractsWithCustomers"),
    "gross_profit": ("GrossProfit",),
    "net_income": ("ProfitLossAttributableToOwnersOfParent", "ProfitLoss"),
    "book_value_equity": ("EquityAttributableToOwnersOfParent", "Equity"),
    "operating_cash_flow": ("CashFlowsFromUsedInOperatingActivities",),
    "capex": ("PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",),
    "total_shares": ("AdjustedWeightedAverageShares",),
    "shares_outstanding": ("NumberOfSharesOutstanding",),
    "total_assets": ("Assets",),
    "current_assets": ("CurrentAssets",),
    "current_liabilities": ("CurrentLiabilities",),
    "long_term_debt": ("LongtermBorrowings",),
    "total_debt": (
        "Borrowings",
        "CurrentBorrowingsAndCurrentPortionOfNoncurrentBorrowings",
        "LongtermBorrowings",
    ),
    "cash_and_equivalents": ("CashAndCashEquivalents",),
}

SEC_FIELD_UNIT_PRIORITY: dict[str, tuple[str, ...]] = {
    "total_shares": ("shares", "USD/shares"),
    "shares_outstanding": ("shares",),
}

SEC_LEGACY_TICKER_CIK_ALIASES: dict[str, dict[str, str]] = {
    "AABA": {"company_name": "Yahoo Inc / Altaba Inc", "cik": "0001011006"},
    "ABC": {"company_name": "Cencora Inc / AmerisourceBergen Corp", "cik": "0001140859"},
    "ADS": {"company_name": "Alliance Data Systems Corp / Bread Financial Holdings Inc", "cik": "0001101215"},
    "AET": {"company_name": "Aetna Inc", "cik": "0001122304"},
    "AGN": {"company_name": "Allergan plc", "cik": "0001578845"},
    "ANTM": {"company_name": "Anthem Inc / Elevance Health Inc", "cik": "0001156039"},
    "ABMD": {"company_name": "ABIOMED Inc", "cik": "0000815094"},
    "ANSS": {"company_name": "ANSYS Inc", "cik": "0001013462"},
    "ARG": {"company_name": "Airgas Inc", "cik": "0000804212"},
    "BCR": {"company_name": "C R Bard Inc", "cik": "0000009892"},
    "BHGE": {"company_name": "Baker Hughes Co", "cik": "0001701605"},
    "BLL": {"company_name": "Ball Corp", "cik": "0000009389"},
    "CA": {"company_name": "CA Inc", "cik": "0000356028"},
    "CBS": {"company_name": "CBS Corp / Paramount Global", "cik": "0000813828"},
    "CCE": {"company_name": "Coca-Cola Enterprises Inc / Coca-Cola European Partners US LLC", "cik": "0001491675"},
    "CHK": {"company_name": "Chesapeake Energy Corp / Expand Energy Corp", "cik": "0000895126"},
    "CMA": {"company_name": "Comerica Inc", "cik": "0000028412"},
    "COG": {"company_name": "Cabot Oil & Gas Corp / Coterra Energy Inc", "cik": "0000858470"},
    "CTL": {"company_name": "CenturyLink Inc / Lumen Technologies Inc", "cik": "0000018926"},
    "CTLT": {"company_name": "Catalent Inc", "cik": "0001596783"},
    "CDAY": {"company_name": "Ceridian HCM Holding Inc / Dayforce Inc", "cik": "0001725057"},
    "DISCA": {"company_name": "Discovery Communications Inc", "cik": "0001437107"},
    "DO": {"company_name": "Diamond Offshore Drilling Inc", "cik": "0000949039"},
    "DRE": {"company_name": "Duke Realty Corp", "cik": "0000783280"},
    "DWDP": {"company_name": "DowDuPont Inc", "cik": "0001666700"},
    "ENDP": {"company_name": "Endo International plc", "cik": "0001593034"},
    "EMC": {"company_name": "EMC Corp", "cik": "0000790070"},
    "FB": {"company_name": "Facebook Inc / Meta Platforms Inc", "cik": "0001326801"},
    "FBHS": {"company_name": "Fortune Brands Home & Security Inc", "cik": "0001519751"},
    "FI": {"company_name": "Fiserv Inc", "cik": "0000798354"},
    "FL": {"company_name": "Foot Locker Inc", "cik": "0000850209"},
    "FLT": {"company_name": "FleetCor Technologies Inc / Corpay Inc", "cik": "0001175454"},
    "GPS": {"company_name": "Gap Inc", "cik": "0000039911"},
    "HAR": {"company_name": "Harman International Industries Inc", "cik": "0000800459"},
    "HOT": {"company_name": "Starwood Hotels & Resorts Worldwide Inc", "cik": "0000316206"},
    "HFC": {"company_name": "HollyFrontier Corp", "cik": "0000048039"},
    "HRS": {"company_name": "Harris Corp / L3Harris Technologies Inc", "cik": "0000202058"},
    "INFO": {"company_name": "IHS Markit Ltd", "cik": "0001598014"},
    "JEC": {"company_name": "Jacobs Engineering Group Inc", "cik": "0000052988"},
    "KORS": {"company_name": "Michael Kors Holdings Ltd / Capri Holdings Ltd", "cik": "0001530721"},
    "LLL": {"company_name": "L3 Technologies Inc", "cik": "0001039101"},
    "MNK": {"company_name": "Mallinckrodt plc", "cik": "0001567892"},
    "NLOK": {"company_name": "NortonLifeLock Inc / Gen Digital Inc", "cik": "0000849399"},
    "PKI": {"company_name": "PerkinElmer Inc / Revvity Inc", "cik": "0000031791"},
    "PXD": {"company_name": "Pioneer Natural Resources Co", "cik": "0001038357"},
    "RE": {"company_name": "Everest Re Group Ltd / Everest Group Ltd", "cik": "0001095073"},
    "RTN": {"company_name": "Raytheon Co", "cik": "0001047122"},
    "SIVB": {"company_name": "SVB Financial Group", "cik": "0000719739"},
    "SPLS": {"company_name": "Staples Inc", "cik": "0000791519"},
    "SYMC": {"company_name": "Symantec Corp / Gen Digital Inc", "cik": "0000849399"},
    "TIF": {"company_name": "Tiffany & Co", "cik": "0000098246"},
    "TMK": {"company_name": "Torchmark Corp / Globe Life Inc", "cik": "0000320335"},
    "TSS": {"company_name": "Total System Services Inc", "cik": "0000721683"},
    "TYC": {"company_name": "Tyco International plc", "cik": "0000833444"},
    "UTX": {"company_name": "United Technologies Corp", "cik": "0000101829"},
    "VAR": {"company_name": "Varian Medical Systems Inc", "cik": "0000203527"},
    "VIAB": {"company_name": "Viacom Inc / Paramount Global", "cik": "0000813828"},
    "VIAC": {"company_name": "ViacomCBS Inc / Paramount Global", "cik": "0000813828"},
    "WCG": {"company_name": "WellCare Health Plans Inc", "cik": "0001279363"},
    "WLTW": {"company_name": "Willis Towers Watson plc", "cik": "0001140536"},
    "WYND": {"company_name": "Wyndham Destinations Inc", "cik": "0001361658"},
    "YHOO": {"company_name": "Yahoo Inc", "cik": "0001011006"},
}


def _parse_iso_date(value: Any) -> str | None:
    text = str(value or "").strip()
    return text[:10] if text else None


def _parse_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


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


_COMPANY_SUFFIX_TOKENS = {
    "a",
    "an",
    "and",
    "class",
    "co",
    "company",
    "corp",
    "corporation",
    "de",
    "group",
    "holdings",
    "inc",
    "incorporated",
    "limited",
    "llc",
    "ltd",
    "new",
    "nv",
    "plc",
    "the",
}


def _company_name_tokens(value: Any) -> set[str]:
    text = html.unescape(str(value or "")).lower()
    text = re.sub(r"\([^)]*\)", " ", text)
    return {
        token
        for token in re.findall(r"[a-z0-9]+", text)
        if token and token not in _COMPANY_SUFFIX_TOKENS
    }


def _normalized_company_name(value: Any) -> str:
    return " ".join(sorted(_company_name_tokens(value)))


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

    def _request_text(self, url: str) -> str:
        if not self.user_agent:
            raise RuntimeError("SEC_USER_AGENT is not configured.")
        if not _extract_email(self.user_agent):
            raise RuntimeError("SEC_USER_AGENT must include a contact email.")
        headers = {
            "User-Agent": self.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
                return payload.decode("utf-8", errors="replace")
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
        normalized_symbol = str(symbol or "").strip().upper()
        identity = self._load_ticker_index().get(normalized_symbol)
        if identity:
            return identity
        legacy_identity = SEC_LEGACY_TICKER_CIK_ALIASES.get(normalized_symbol)
        if not legacy_identity:
            return None
        return {
            "symbol": normalized_symbol,
            "canonical_symbol": normalized_symbol,
            "company_name": legacy_identity["company_name"],
            "cik": legacy_identity["cik"],
            "exchange": "",
            "ipo_date": None,
            "delisting_date": None,
            "source": f"{self.provider_name}_legacy_alias",
            "valid_from": None,
            "valid_to": None,
        }

    def resolve_identity_from_browse(self, symbol: str) -> dict[str, Any] | None:
        normalized_symbol = str(symbol or "").strip().upper()
        if not normalized_symbol:
            return None
        query = urllib.parse.urlencode(
            {"CIK": normalized_symbol, "owner": "exclude", "action": "getcompany"}
        )
        text = self._request_text(f"{SEC_BROWSE_EDGAR_URL}?{query}")
        if "No matching CIK" in text or "No matching companies" in text:
            return None
        match = re.search(
            r'companyName">([^<]+).*?CIK.*?CIK=([0-9]{1,10})',
            text,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if not match:
            match = re.search(
                r'companyName">([^<]+).*?>([0-9]{10}) \(see all company filings\)',
                text,
                flags=re.IGNORECASE | re.DOTALL,
            )
        if not match:
            return None
        return {
            "symbol": normalized_symbol,
            "canonical_symbol": normalized_symbol,
            "company_name": html.unescape(re.sub(r"\s+", " ", match.group(1))).strip(),
            "cik": str(match.group(2)).zfill(10),
            "exchange": "",
            "ipo_date": None,
            "delisting_date": None,
            "source": self.provider_name,
            "valid_from": None,
            "valid_to": None,
        }

    def resolve_identity_by_company_name(self, symbol: str, company_name: str) -> dict[str, Any] | None:
        normalized_symbol = str(symbol or "").strip().upper()
        query_text = str(company_name or "").strip()
        if not normalized_symbol or not query_text:
            return None
        query = urllib.parse.urlencode(
            {
                "q": query_text,
                "dateRange": "all",
                "category": "custom",
                "forms": "10-K,10-Q,20-F,40-F",
            }
        )
        payload = self._request_json(f"{SEC_SEARCH_INDEX_URL}?{query}")
        hits = ((payload or {}).get("hits") or {}).get("hits") or []
        query_tokens = _company_name_tokens(query_text)
        normalized_query = _normalized_company_name(query_text)
        best: tuple[float, dict[str, Any]] | None = None
        for hit in hits if isinstance(hits, list) else []:
            if not isinstance(hit, Mapping):
                continue
            source = hit.get("_source") if isinstance(hit.get("_source"), Mapping) else {}
            ciks = source.get("ciks") if isinstance(source, Mapping) else []
            display_names = source.get("display_names") if isinstance(source, Mapping) else []
            if not isinstance(ciks, list) or not isinstance(display_names, list):
                continue
            for index, raw_display_name in enumerate(display_names):
                cik = str(ciks[index] if index < len(ciks) else (ciks[0] if ciks else "")).strip()
                if not cik:
                    continue
                display_name = html.unescape(str(raw_display_name or ""))
                candidate_name = re.sub(r"\s*\([^)]*CIK[^)]*\)\s*", " ", display_name, flags=re.IGNORECASE)
                candidate_name = re.sub(r"\s*\([^)]*\)\s*", " ", candidate_name)
                candidate_name = re.sub(r"\s+", " ", candidate_name).strip()
                candidate_tokens = _company_name_tokens(candidate_name)
                if not candidate_tokens:
                    continue
                score = len(query_tokens & candidate_tokens) / max(len(query_tokens), 1)
                normalized_candidate = _normalized_company_name(candidate_name)
                if normalized_query and normalized_query in normalized_candidate:
                    score = max(score, 1.0)
                if score < 0.5:
                    continue
                identity = {
                    "symbol": normalized_symbol,
                    "canonical_symbol": normalized_symbol,
                    "company_name": candidate_name,
                    "cik": cik.zfill(10),
                    "exchange": "",
                    "ipo_date": None,
                    "delisting_date": None,
                    "source": f"{self.provider_name}_company_search",
                    "valid_from": None,
                    "valid_to": None,
                }
                if best is None or score > best[0]:
                    best = (score, identity)
        return dict(best[1]) if best else None

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

    def fetch_company_facts(self, symbol: str) -> dict[str, Any]:
        identity = self.resolve_identity(symbol)
        if not identity or not identity.get("cik"):
            raise RuntimeError(f"No SEC identity mapping available for {symbol}.")
        cik = str(identity["cik"]).zfill(10)
        return self.fetch_company_facts_by_cik(cik, symbol=symbol)

    def fetch_company_facts_by_cik(self, cik: str, *, symbol: str | None = None) -> dict[str, Any]:
        cik = str(cik or "").strip().zfill(10)
        if not cik or not cik.isdigit():
            raise RuntimeError(f"No SEC identity mapping available for {symbol or cik}.")
        payload = self._request_json(SEC_COMPANYFACTS_URL.format(cik=cik))
        if not isinstance(payload, dict):
            raise RuntimeError(f"Unexpected SEC companyfacts payload for {symbol or cik}.")
        return payload

    def _iter_fact_rows(self, fact_payload: Mapping[str, Any], field_name: str) -> list[dict[str, Any]]:
        units = fact_payload.get("units")
        if not isinstance(units, dict):
            return []
        priority = SEC_FIELD_UNIT_PRIORITY.get(field_name, ("USD", "shares", "pure"))
        rows: list[dict[str, Any]] = []
        for unit_name in priority:
            unit_rows = units.get(unit_name)
            if isinstance(unit_rows, list):
                rows.extend(dict(row) for row in unit_rows if isinstance(row, dict))
                if rows:
                    return rows
        for unit_rows in units.values():
            if isinstance(unit_rows, list):
                rows.extend(dict(row) for row in unit_rows if isinstance(row, dict))
        return rows

    def fetch_fundamental_points(
        self,
        symbol: str,
        *,
        start_date: date | None = None,
        end_date: date | None = None,
        max_periods: int = 48,
    ) -> list[dict[str, Any]]:
        payload = self.fetch_company_facts(symbol)
        normalized_symbol = symbol.upper()
        return self._fundamental_points_from_payload(
            normalized_symbol,
            payload,
            start_date=start_date,
            end_date=end_date,
            max_periods=max_periods,
        )

    def fetch_fundamental_points_for_cik(
        self,
        symbol: str,
        cik: str,
        *,
        start_date: date | None = None,
        end_date: date | None = None,
        max_periods: int = 48,
    ) -> list[dict[str, Any]]:
        payload = self.fetch_company_facts_by_cik(cik, symbol=symbol)
        return self._fundamental_points_from_payload(
            symbol.upper(),
            payload,
            start_date=start_date,
            end_date=end_date,
            max_periods=max_periods,
        )

    def _fundamental_points_from_payload(
        self,
        normalized_symbol: str,
        payload: Mapping[str, Any],
        *,
        start_date: date | None = None,
        end_date: date | None = None,
        max_periods: int = 48,
    ) -> list[dict[str, Any]]:
        fact_root = payload.get("facts") if isinstance(payload, dict) else {}
        if not isinstance(fact_root, dict):
            return []
        taxonomy_sources: list[tuple[str, Mapping[str, Any], dict[str, tuple[str, ...]]]] = []
        us_gaap_facts = fact_root.get("us-gaap")
        if isinstance(us_gaap_facts, dict):
            taxonomy_sources.append(("us-gaap", us_gaap_facts, SEC_FUNDAMENTAL_FACT_TAGS))
        ifrs_facts = fact_root.get("ifrs-full")
        if isinstance(ifrs_facts, dict):
            taxonomy_sources.append(("ifrs-full", ifrs_facts, SEC_IFRS_FUNDAMENTAL_FACT_TAGS))
        if not taxonomy_sources:
            return []
        points_by_key: dict[tuple[str, str], dict[str, Any]] = {}
        fact_tags_by_key: dict[tuple[str, str], set[str]] = {}
        fact_taxonomies_by_key: dict[tuple[str, str], set[str]] = {}
        for taxonomy_name, facts, tag_map in taxonomy_sources:
            for field_name, tag_names in tag_map.items():
                for tag_name in tag_names:
                    fact_payload = facts.get(tag_name)
                    if not isinstance(fact_payload, dict):
                        continue
                    for row in self._iter_fact_rows(fact_payload, field_name):
                        form = str(row.get("form") or "").strip().upper()
                        if form and form not in FUNDAMENTAL_REPORT_FORMS:
                            continue
                        period_end = _parse_iso_date(row.get("end"))
                        filed = _parse_iso_date(row.get("filed"))
                        value = _parse_float(row.get("val"))
                        if not period_end or not filed or value is None:
                            continue
                        if start_date and period_end < start_date.isoformat():
                            continue
                        if end_date and period_end > end_date.isoformat():
                            continue
                        key = (period_end, filed)
                        point = points_by_key.setdefault(
                            key,
                            {
                                "symbol": normalized_symbol,
                                "date": period_end,
                                "period_end_date": period_end,
                                "publish_date": filed,
                                "statement_date": period_end,
                                "available_at": filed,
                                "fiscal_year": row.get("fy"),
                                "fiscal_period": row.get("fp"),
                                "time_provenance": "sec_companyfacts_filed_date",
                                "source": self.provider_name,
                                "metadata": {
                                    "provider": self.provider_name,
                                    "cik": str(payload.get("cik") or "").zfill(10),
                                    "form": form,
                                    "accession_number": row.get("accn"),
                                    "frame": row.get("frame"),
                                    "phase2_refresh": True,
                                },
                            },
                        )
                        if point.get(field_name) is None:
                            point[field_name] = value
                        fact_tags_by_key.setdefault(key, set()).add(tag_name)
                        fact_taxonomies_by_key.setdefault(key, set()).add(taxonomy_name)
                        metadata = point.setdefault("metadata", {})
                        if isinstance(metadata, dict):
                            metadata["fact_tags"] = sorted(fact_tags_by_key[key])
                            metadata["fact_taxonomies"] = sorted(fact_taxonomies_by_key[key])
        points = sorted(
            points_by_key.values(),
            key=lambda item: (str(item.get("date") or ""), str(item.get("available_at") or "")),
            reverse=True,
        )
        return points[: max(1, int(max_periods))]

    def fetch_history(self, symbol: str, start_date: date, end_date: date) -> Any:
        raise RuntimeError(
            "SEC EDGAR does not provide daily price bars in this slice; use Tiingo or FMP for price history."
        )


SecEdgarEventProvider = SecEdgarProvider

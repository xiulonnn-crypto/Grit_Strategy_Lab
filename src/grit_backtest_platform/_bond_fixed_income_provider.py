from __future__ import annotations

import csv
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from io import StringIO
from statistics import mean
from typing import Any, Mapping


TREASURY_XML_URL = (
    "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml"
    "?data={dataset}&field_tdr_date_value_month={month}"
)
TREASURY_TIPS_CPI_URL = "https://www.treasurydirect.gov/TA_WS/secindex/current/CPI?format=json"
ISHARES_LQD_PRODUCT_URL = (
    "https://www.ishares.com/us/products/239566/ishares-iboxx-investment-grade-corporate-bond-etf"
)
ISHARES_LQD_HOLDINGS_URL = (
    "https://www.ishares.com/us/products/239566/ishares-iboxx-investment-grade-corporate-bond-etf/"
    "1467271812596.ajax?fileType=csv&fileName=LQD_holdings&dataType=fund"
)


@dataclass
class BondFixedIncomeProviderResult:
    snapshots: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    telemetry: dict[str, Any] = field(default_factory=dict)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _fetch_text(url: str, *, timeout: float = 20.0) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "GritStrategyLab/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8-sig", errors="replace")


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _float_or_none(value: Any) -> float | None:
    try:
        if value in (None, ""):
            return None
        return float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def _date_only(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    return text.split("T", 1)[0]


def _month_candidates(today: date) -> list[str]:
    first_this_month = today.replace(day=1)
    previous_month_end = first_this_month - timedelta(days=1)
    return [today.strftime("%Y%m"), previous_month_end.strftime("%Y%m")]


def _parse_treasury_xml_rows(xml_text: str) -> list[dict[str, str]]:
    root = ET.fromstring(xml_text)
    rows: list[dict[str, str]] = []
    for entry in root.findall("{http://www.w3.org/2005/Atom}entry"):
        row: dict[str, str] = {}
        for child in entry.iter():
            name = _local_name(child.tag)
            if name in {"properties", "content", "entry"}:
                continue
            if child.text is not None:
                row[name] = child.text.strip()
        if row:
            rows.append(row)
    return rows


def _latest_treasury_rows(dataset: str, *, today: date, timeout: float) -> tuple[list[dict[str, str]], str, str | None]:
    last_endpoint = ""
    for month in _month_candidates(today):
        endpoint = TREASURY_XML_URL.format(dataset=dataset, month=month)
        last_endpoint = endpoint
        rows = _parse_treasury_xml_rows(_fetch_text(endpoint, timeout=timeout))
        rows = [row for row in rows if row]
        if rows:
            return rows, endpoint, rows[-1].get("updated")
    return [], last_endpoint, None


def _modified_duration(years: float, ytm_pct: float | None) -> float | None:
    if ytm_pct is None:
        return None
    return round(years / (1.0 + (ytm_pct / 100.0)), 4)


def _convexity_proxy(years: float, ytm_pct: float | None) -> float | None:
    if ytm_pct is None:
        return None
    return round((years * (years + 1.0)) / ((1.0 + (ytm_pct / 100.0)) ** 2) / 100.0, 4)


def _common_raw(
    *,
    provider: str,
    endpoint: str,
    dataset: str,
    record_as_of: str | None,
    raw_fields: Mapping[str, Any],
    proxy_kind: str,
    yield_basis: str,
    audit_profile: str,
    tenor_label: str,
    fetched_at: str,
    missing_official_fields: list[str] | None = None,
    extra: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    payload = {
        "provider": provider,
        "endpoint": endpoint,
        "dataset": dataset,
        "fetched_at": fetched_at,
        "record_as_of": record_as_of,
        "raw_fields": dict(raw_fields),
        "proxy_kind": proxy_kind,
        "yield_basis": yield_basis,
        "audit_profile": audit_profile,
        "tenor_label": tenor_label,
        "missing_official_fields": list(missing_official_fields or []),
    }
    payload.update(dict(extra or {}))
    return payload


def _bill_snapshot(row: Mapping[str, str], *, endpoint: str, fetched_at: str) -> dict[str, Any] | None:
    snapshot_date = _date_only(row.get("INDEX_DATE") or row.get("QUOTE_DATE"))
    discount_rate = _float_or_none(row.get("ROUND_B1_CLOSE_13WK_2"))
    ytm = _float_or_none(row.get("ROUND_B1_YIELD_13WK_2"))
    if not snapshot_date or discount_rate is None or ytm is None:
        return None
    snapshot_id = f"bond_fixed_income::UST_BILL_3M::{snapshot_date}::us_treasury_xml"
    clean_price = round(100.0 * (1.0 - (discount_rate / 100.0) * (91.0 / 360.0)), 6)
    raw = _common_raw(
        provider="us_treasury_xml",
        endpoint=endpoint,
        dataset="daily_treasury_bill_rates",
        record_as_of=snapshot_date,
        raw_fields=row,
        proxy_kind="UST_BILL",
        yield_basis="discount_and_equivalent_yield",
        audit_profile="UST_BILL_3M",
        tenor_label="3M",
        fetched_at=fetched_at,
        extra={
            "asset_type": "INDIVIDUAL_BOND",
            "discount_rate_pct": discount_rate,
            "audit_notes": ["T-Bill accrued interest audit waived; accrued is fixed at 0."],
            "tracking_status": "READY",
        },
    )
    return {
        "id": snapshot_id,
        "instrument_id": "UST_BILL_3M",
        "symbol": "TBILL3M",
        "cusip": str(row.get("CUSIP_13WK") or "") or None,
        "name": "US Treasury 13-Week Bill",
        "instrument_type": "treasury_bill",
        "currency": "USD",
        "snapshot_date": snapshot_date,
        "maturity_date": _date_only(row.get("MATURITY_DATE_13WK")),
        "clean_price": clean_price,
        "net_price": clean_price,
        "dirty_price": clean_price,
        "full_price": clean_price,
        "accrued_interest": 0.0,
        "ytm_pct": ytm,
        "duration": 0.25,
        "convexity": 0.0,
        "source": "us_treasury_xml",
        "source_snapshot_id": snapshot_id,
        "refresh_status": "READY",
        "missing_fields": [],
        "inferred_fields": {
            "clean_price": "discount_rate_proxy",
            "net_price": "discount_rate_proxy",
            "dirty_price": "discount_rate_proxy",
            "full_price": "discount_rate_proxy",
            "accrued_interest": "t_bill_waiver",
            "duration": "maturity_proxy",
            "convexity": "discount_bill_proxy",
        },
        "raw": raw,
    }


def _ust_cmt_snapshot(
    row: Mapping[str, str],
    *,
    tenor: str,
    field_name: str,
    years: float,
    endpoint: str,
    fetched_at: str,
    spread_10y_2y_bps: float | None = None,
) -> dict[str, Any] | None:
    snapshot_date = _date_only(row.get("NEW_DATE"))
    ytm = _float_or_none(row.get(field_name))
    if not snapshot_date or ytm is None:
        return None
    instrument_id = f"UST_CMT_{tenor}"
    snapshot_id = f"bond_fixed_income::{instrument_id}::{snapshot_date}::us_treasury_xml"
    audit_alerts: list[str] = []
    if tenor in {"2Y", "10Y"} and spread_10y_2y_bps is not None and not (-100.0 < spread_10y_2y_bps < 300.0):
        audit_alerts.append(f"UST 10Y-2Y spread out of policy range: {spread_10y_2y_bps:.2f} bps.")
    raw = _common_raw(
        provider="us_treasury_xml",
        endpoint=endpoint,
        dataset="daily_treasury_yield_curve",
        record_as_of=snapshot_date,
        raw_fields=row,
        proxy_kind="UST_CMT_PROXY",
        yield_basis="nominal",
        audit_profile=f"UST_CMT_{tenor}",
        tenor_label=tenor,
        fetched_at=fetched_at,
        extra={
            "asset_type": "INDIVIDUAL_BOND",
            "spread_10y_2y_bps": spread_10y_2y_bps,
            "audit_alerts": audit_alerts,
            "tracking_status": "READY" if not audit_alerts else "ALERT",
        },
    )
    return {
        "id": snapshot_id,
        "instrument_id": instrument_id,
        "symbol": f"UST{tenor}",
        "name": f"US Treasury CMT {tenor}",
        "instrument_type": "treasury_cmt",
        "currency": "USD",
        "snapshot_date": snapshot_date,
        "clean_price": 100.0,
        "net_price": 100.0,
        "dirty_price": 100.0,
        "full_price": 100.0,
        "accrued_interest": 0.0,
        "ytm_pct": ytm,
        "duration": _modified_duration(years, ytm),
        "convexity": _convexity_proxy(years, ytm),
        "source": "us_treasury_xml",
        "source_snapshot_id": snapshot_id,
        "refresh_status": "READY",
        "missing_fields": [],
        "inferred_fields": {
            "clean_price": "cmt_par_proxy",
            "net_price": "cmt_par_proxy",
            "dirty_price": "cmt_par_proxy",
            "full_price": "cmt_par_proxy",
            "accrued_interest": "cmt_par_proxy",
            "duration": "cmt_modified_duration_proxy",
            "convexity": "cmt_convexity_proxy",
        },
        "raw": raw,
    }


def _tips_snapshot(
    row: Mapping[str, str],
    *,
    tenor: str,
    field_name: str,
    years: float,
    endpoint: str,
    fetched_at: str,
    inflation_factor: float | None,
    breakeven_inflation_bps: float | None = None,
) -> dict[str, Any] | None:
    snapshot_date = _date_only(row.get("NEW_DATE"))
    real_yield = _float_or_none(row.get(field_name))
    if not snapshot_date or real_yield is None:
        return None
    instrument_id = f"TIPS_{tenor}"
    snapshot_id = f"bond_fixed_income::{instrument_id}::{snapshot_date}::us_treasury_xml"
    missing_fields = [] if inflation_factor is not None else ["inflation_factor"]
    raw = _common_raw(
        provider="us_treasury_xml",
        endpoint=endpoint,
        dataset="daily_treasury_real_yield_curve",
        record_as_of=snapshot_date,
        raw_fields=row,
        proxy_kind="TIPS_REAL_CMT_PROXY",
        yield_basis="real",
        audit_profile=f"TIPS_{tenor}",
        tenor_label=tenor,
        fetched_at=fetched_at,
        missing_official_fields=missing_fields,
        extra={
            "asset_type": "INDIVIDUAL_BOND",
            "real_yield_pct": real_yield,
            "inflation_factor": inflation_factor,
            "breakeven_inflation_bps": breakeven_inflation_bps,
            "audit_alerts": [],
            "tracking_status": "READY" if not missing_fields else "WATCH",
        },
    )
    return {
        "id": snapshot_id,
        "instrument_id": instrument_id,
        "symbol": f"TIPS{tenor}",
        "name": f"US TIPS Real Yield {tenor}",
        "instrument_type": "tips_cmt",
        "currency": "USD",
        "snapshot_date": snapshot_date,
        "clean_price": 100.0,
        "net_price": 100.0,
        "dirty_price": 100.0,
        "full_price": 100.0,
        "accrued_interest": 0.0,
        "ytm_pct": real_yield,
        "duration": _modified_duration(years, real_yield),
        "convexity": _convexity_proxy(years, real_yield),
        "source": "us_treasury_xml",
        "source_snapshot_id": snapshot_id,
        "refresh_status": "READY" if not missing_fields else "WATCH",
        "missing_fields": missing_fields,
        "inferred_fields": {
            "clean_price": "tips_real_cmt_par_proxy",
            "net_price": "tips_real_cmt_par_proxy",
            "dirty_price": "tips_real_cmt_par_proxy",
            "full_price": "tips_real_cmt_par_proxy",
            "accrued_interest": "tips_real_cmt_proxy",
            "duration": "tips_real_cmt_duration_proxy",
            "convexity": "tips_real_cmt_convexity_proxy",
        },
        "raw": raw,
    }


def _average_current_tips_index_ratio(*, timeout: float) -> tuple[float | None, dict[str, Any]]:
    text = _fetch_text(TREASURY_TIPS_CPI_URL, timeout=timeout)
    rows = json.loads(text)
    ratios = [_float_or_none(item.get("dailyIndex")) for item in rows if isinstance(item, Mapping)]
    ratios = [item for item in ratios if item is not None]
    if not ratios:
        return None, {"endpoint": TREASURY_TIPS_CPI_URL, "row_count": 0}
    return round(mean(ratios), 8), {"endpoint": TREASURY_TIPS_CPI_URL, "row_count": len(ratios)}


def _extract_percent_after(label: str, html: str) -> float | None:
    pattern = re.compile(re.escape(label) + r"\s+as of\s+[^<]{1,80}?\s+(-?\d+(?:\.\d+)?)%", re.IGNORECASE)
    match = pattern.search(re.sub(r"<[^>]+>", " ", html))
    return _float_or_none(match.group(1)) if match else None


def _extract_number_after(label: str, html: str) -> float | None:
    text = re.sub(r"<[^>]+>", " ", html)
    pattern = re.compile(re.escape(label) + r"\s+as of\s+[^<]{1,80}?\s+(-?\d+(?:\.\d+)?)", re.IGNORECASE)
    match = pattern.search(text)
    return _float_or_none(match.group(1)) if match else None


def _extract_rating_distribution(html: str) -> dict[str, float]:
    match = re.search(r"var\s+tabsRatingDataTable\s*=\s*(\[[\s\S]*?\]);", html)
    if not match:
        return {}
    raw = match.group(1)
    raw = re.sub(r",\s*}", "}", raw)
    raw = re.sub(r",\s*]", "]", raw)
    try:
        rows = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    distribution: dict[str, float] = {}
    for row in rows:
        if not isinstance(row, Mapping):
            continue
        label = str(row.get("name") or "").upper()
        value = _float_or_none(row.get("value"))
        if value is None:
            continue
        if label.startswith("AAA"):
            distribution["AAA"] = value
        elif label.startswith("AA "):
            distribution["AA"] = value
        elif label.startswith("A "):
            distribution["A"] = value
        elif label.startswith("BBB"):
            distribution["BBB"] = value
    return distribution


def _parse_lqd_holdings(csv_text: str) -> dict[str, Any]:
    rows = [line for line in csv_text.splitlines() if line.strip()]
    header_index = next((idx for idx, line in enumerate(rows) if line.startswith("Name,Sector,Asset Class,")), -1)
    if header_index < 0:
        return {}
    reader = csv.DictReader(StringIO("\n".join(rows[header_index:])))
    durations: list[float] = []
    ytms: list[float] = []
    prices: list[float] = []
    for row in reader:
        if not row:
            continue
        duration = _float_or_none(row.get("Duration") or row.get("Mod. Duration"))
        ytm = _float_or_none(row.get("YTM (%)"))
        price = _float_or_none(row.get("Price"))
        weight = _float_or_none(row.get("Weight (%)")) or 0.0
        if weight > 0 and duration is not None:
            durations.append(duration * weight)
        if weight > 0 and ytm is not None:
            ytms.append(ytm * weight)
        if weight > 0 and price is not None:
            prices.append(price * weight)
    return {
        "weighted_duration": round(sum(durations) / 100.0, 4) if durations else None,
        "weighted_ytm": round(sum(ytms) / 100.0, 4) if ytms else None,
        "weighted_price": round(sum(prices) / 100.0, 4) if prices else None,
    }


def _lqd_snapshot(*, fetched_at: str, timeout: float) -> dict[str, Any] | None:
    product_html = _fetch_text(ISHARES_LQD_PRODUCT_URL, timeout=timeout)
    holdings_csv = _fetch_text(ISHARES_LQD_HOLDINGS_URL, timeout=timeout)
    holdings_summary = _parse_lqd_holdings(holdings_csv)
    sec_yield = _extract_percent_after("30 Day SEC Yield", product_html)
    effective_duration = _extract_number_after("Effective Duration", product_html)
    avg_ytm = _extract_percent_after("Average Yield to Maturity", product_html)
    credit_quality = _extract_rating_distribution(product_html)
    snapshot_date_match = re.search(r"as of\s+([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})", product_html)
    snapshot_date = None
    if snapshot_date_match:
        try:
            snapshot_date = datetime.strptime(snapshot_date_match.group(1), "%b %d, %Y").date().isoformat()
        except ValueError:
            snapshot_date = None
    snapshot_date = snapshot_date or date.today().isoformat()
    snapshot_id = f"bond_fixed_income::LQD::{snapshot_date}::ishares"
    effective_duration = effective_duration or holdings_summary.get("weighted_duration")
    avg_ytm = avg_ytm or holdings_summary.get("weighted_ytm")
    clean_price = holdings_summary.get("weighted_price")
    missing_fields = [
        field_name
        for field_name, value in {
            "effective_duration": effective_duration,
            "sec_yield_30d_pct": sec_yield,
            "credit_quality": credit_quality or None,
            "tracking_error_bps": None,
        }.items()
        if value in (None, {})
    ]
    raw = _common_raw(
        provider="ishares",
        endpoint=ISHARES_LQD_PRODUCT_URL,
        dataset="LQD",
        record_as_of=snapshot_date,
        raw_fields={
            "sec_yield_30d_pct": sec_yield,
            "effective_duration": effective_duration,
            "average_yield_to_maturity_pct": avg_ytm,
            "credit_quality": credit_quality,
            "holdings_summary": holdings_summary,
        },
        proxy_kind="ETF_OFFICIAL",
        yield_basis="sec_yield",
        audit_profile="LQD_BOND_ETF",
        tenor_label="LQD",
        fetched_at=fetched_at,
        missing_official_fields=missing_fields,
        extra={
            "asset_type": "BOND_ETF",
            "effective_duration": effective_duration,
            "sec_yield_30d_pct": sec_yield,
            "credit_quality": credit_quality,
            "tracking_error_bps": None,
            "tracking_status": "WATCH",
            "audit_alerts": ["Official free tracking_error_bps was not found; LQD remains WATCH."],
            "audit_notes": ["ETF accrued-interest gap audit is waived; tracking error gates Ready."],
            "holdings_endpoint": ISHARES_LQD_HOLDINGS_URL,
        },
    )
    return {
        "id": snapshot_id,
        "instrument_id": "LQD",
        "symbol": "LQD",
        "cusip": "464287242",
        "name": "iShares iBoxx $ Investment Grade Corporate Bond ETF",
        "instrument_type": "bond_etf",
        "currency": "USD",
        "snapshot_date": snapshot_date,
        "clean_price": clean_price,
        "net_price": clean_price,
        "dirty_price": clean_price,
        "full_price": clean_price,
        "accrued_interest": 0.0,
        "ytm_pct": avg_ytm,
        "duration": effective_duration,
        "convexity": None,
        "source": "ishares",
        "source_snapshot_id": snapshot_id,
        "refresh_status": "WATCH",
        "missing_fields": missing_fields,
        "inferred_fields": {"accrued_interest": "bond_etf_not_applicable"},
        "raw": raw,
    }


def fetch_official_bond_fixed_income_snapshots(
    *,
    today: date | None = None,
    timeout: float = 20.0,
) -> BondFixedIncomeProviderResult:
    as_of = today or date.today()
    fetched_at = _utc_now()
    result = BondFixedIncomeProviderResult(telemetry={"fetched_at": fetched_at, "sources": {}})

    try:
        bill_rows, bill_endpoint, _ = _latest_treasury_rows(
            "daily_treasury_bill_rates",
            today=as_of,
            timeout=timeout,
        )
        result.telemetry["sources"]["daily_treasury_bill_rates"] = {"endpoint": bill_endpoint, "rows": len(bill_rows)}
        bill = _bill_snapshot(bill_rows[-1], endpoint=bill_endpoint, fetched_at=fetched_at) if bill_rows else None
        if bill:
            result.snapshots.append(bill)
        else:
            result.warnings.append("Treasury bill feed returned no usable 13-week bill row.")
    except Exception as exc:
        result.errors.append(f"Treasury bill feed failed: {exc}")

    nominal_row: dict[str, str] | None = None
    try:
        nominal_rows, nominal_endpoint, _ = _latest_treasury_rows(
            "daily_treasury_yield_curve",
            today=as_of,
            timeout=timeout,
        )
        result.telemetry["sources"]["daily_treasury_yield_curve"] = {
            "endpoint": nominal_endpoint,
            "rows": len(nominal_rows),
        }
        nominal_row = nominal_rows[-1] if nominal_rows else None
        spread = None
        if nominal_row:
            y2 = _float_or_none(nominal_row.get("BC_2YEAR"))
            y10 = _float_or_none(nominal_row.get("BC_10YEAR"))
            if y2 is not None and y10 is not None:
                spread = round((y10 - y2) * 100.0, 4)
            for tenor, field_name, years in (
                ("2Y", "BC_2YEAR", 2.0),
                ("10Y", "BC_10YEAR", 10.0),
                ("30Y", "BC_30YEAR", 30.0),
            ):
                snapshot = _ust_cmt_snapshot(
                    nominal_row,
                    tenor=tenor,
                    field_name=field_name,
                    years=years,
                    endpoint=nominal_endpoint,
                    fetched_at=fetched_at,
                    spread_10y_2y_bps=spread,
                )
                if snapshot:
                    result.snapshots.append(snapshot)
        else:
            result.warnings.append("Treasury nominal yield curve feed returned no usable row.")
    except Exception as exc:
        result.errors.append(f"Treasury nominal yield curve feed failed: {exc}")

    inflation_factor = None
    try:
        inflation_factor, tips_cpi_telemetry = _average_current_tips_index_ratio(timeout=timeout)
        result.telemetry["sources"]["treasurydirect_tips_cpi"] = tips_cpi_telemetry
    except Exception as exc:
        result.warnings.append(f"TreasuryDirect TIPS/CPI inflation factor fetch failed: {exc}")

    try:
        real_rows, real_endpoint, _ = _latest_treasury_rows(
            "daily_treasury_real_yield_curve",
            today=as_of,
            timeout=timeout,
        )
        result.telemetry["sources"]["daily_treasury_real_yield_curve"] = {
            "endpoint": real_endpoint,
            "rows": len(real_rows),
        }
        real_row = real_rows[-1] if real_rows else None
        nominal_10y = _float_or_none((nominal_row or {}).get("BC_10YEAR"))
        if real_row:
            for tenor, field_name, years in (("5Y", "TC_5YEAR", 5.0), ("10Y", "TC_10YEAR", 10.0)):
                real_yield = _float_or_none(real_row.get(field_name))
                breakeven = (
                    round((nominal_10y - real_yield) * 100.0, 4)
                    if tenor == "10Y" and nominal_10y is not None and real_yield is not None
                    else None
                )
                snapshot = _tips_snapshot(
                    real_row,
                    tenor=tenor,
                    field_name=field_name,
                    years=years,
                    endpoint=real_endpoint,
                    fetched_at=fetched_at,
                    inflation_factor=inflation_factor,
                    breakeven_inflation_bps=breakeven,
                )
                if snapshot:
                    result.snapshots.append(snapshot)
        else:
            result.warnings.append("Treasury real yield curve feed returned no usable row.")
    except Exception as exc:
        result.errors.append(f"Treasury real yield curve feed failed: {exc}")

    try:
        lqd = _lqd_snapshot(fetched_at=fetched_at, timeout=timeout)
        result.telemetry["sources"]["ishares_lqd"] = {
            "endpoint": ISHARES_LQD_PRODUCT_URL,
            "holdings_endpoint": ISHARES_LQD_HOLDINGS_URL,
            "rows": 1 if lqd else 0,
        }
        if lqd:
            result.snapshots.append(lqd)
        else:
            result.warnings.append("iShares LQD source returned no usable official ETF row.")
    except Exception as exc:
        result.errors.append(f"iShares LQD source failed: {exc}")

    result.telemetry["snapshot_count"] = len(result.snapshots)
    return result

from __future__ import annotations

import math

from grit_backtest_platform.sec_edgar_provider import SecEdgarProvider
from grit_backtest_platform.structured_notes import (
    evaluate_fcn_note_signals,
    parse_html_tables,
    parse_sec_424b2_structured_note,
)


JPM_424B2_HTML = """
<html>
  <body>
    <h1>Auto Callable Contingent Interest Notes Linked to the Least Performing of NVDA, MSFT and TSLA</h1>
    <p>CUSIP: 48133AAA1. The notes are automatically called if each reference stock is at or above its call value.</p>
    <p>These notes have a memory feature for previously unpaid contingent interest payments.</p>
    <table>
      <tr><td>Pricing Date</td><td>January 15, 2026</td></tr>
      <tr><td>Original Issue Date</td><td>January 20, 2026</td></tr>
      <tr><td>Maturity Date</td><td>January 20, 2028</td></tr>
      <tr><td>Contingent Interest Rate</td><td>13.50% per annum, payable monthly</td></tr>
      <tr><td>Interest Barrier/Trigger Value</td><td>60.00% of its Strike Value</td></tr>
      <tr><td>Review Dates</td><td>Monthly review dates, with quarterly automatic call observation dates.</td></tr>
    </table>
    <table>
      <tr><th colspan="4">Key Terms Relating to the Reference Stocks</th></tr>
      <tr>
        <th>Reference Stock</th>
        <th>Bloomberg Ticker Symbol</th>
        <th>Strike Value</th>
        <th>Interest Barrier/Trigger Value</th>
      </tr>
      <tr><td>NVIDIA Corporation common stock</td><td>NVDA</td><td>$100.00</td><td>$60.00</td></tr>
      <tr><td>Microsoft Corporation common stock</td><td>MSFT</td><td>$200.00</td><td>$120.00</td></tr>
      <tr><td>Tesla, Inc. common stock</td><td>TSLA</td><td>$300.00</td><td>$180.00</td></tr>
    </table>
  </body>
</html>
"""


BOFA_424B2_HTML = """
<html>
  <body>
    <h1>Auto-Callable Yield Notes with Memory Feature Linked to the Least Performing Underlying Stock</h1>
    <table>
      <tr><td>Contingent Coupon Rate</td><td>10.20% per annum, paid monthly if the threshold test is satisfied.</td></tr>
      <tr><td>Threshold Value</td><td>60.00% of Starting Value</td></tr>
    </table>
    <table>
      <tr>
        <th rowspan="1">Underlying Stock</th>
        <th>Ticker Symbol</th>
        <th>Starting Value</th>
        <th>Threshold Value</th>
      </tr>
      <tr><td>Apple Inc.</td><td>AAPL</td><td>$250.00</td><td>$150.00</td></tr>
    </table>
  </body>
</html>
"""


JPM_LONG_LABEL_424B2_HTML = """
<html>
  <body>
    <h1>Callable Contingent Interest Notes Linked to the Least Performing of Three Underlyings</h1>
    <p>CUSIP: 48133BBB2.</p>
    <table>
      <tr>
        <td>Terms</td>
        <td>
          Contingent Interest Payments: if, on any Review Date, the closing value of each underlying
          is greater than or equal to its Interest Barrier, you will receive a payment equal to 9.80%
          per annum. Interest Barrier: With respect to each underlying, 70.00% of its Initial Value.
          Trigger Value: With respect to each underlying, 60.00% of its Initial Value. The notes are
          subject to automatic call on monthly Review Dates.
        </td>
      </tr>
    </table>
    <p>The Index is the Russell 2000 Index. Bloomberg ticker: RTY.</p>
    <p>The Index is the S&P 500 Index. Bloomberg ticker: SPX.</p>
    <p>The Fund is the SPDR S&P Regional Banking ETF. Bloomberg ticker: KRE.</p>
    <table>
      <tr><th>Underlying</th><th>Ticker Symbol</th><th>Initial Value</th></tr>
      <tr><td>Russell 2000 Index</td><td>RTY</td><td>$100.00</td></tr>
      <tr><td>S&P 500 Index</td><td>SPX</td><td>$100.00</td></tr>
      <tr><td>SPDR S&P Regional Banking ETF</td><td>KRE</td><td>$100.00</td></tr>
    </table>
  </body>
</html>
"""


def test_sec_424b2_parser_extracts_jpm_fcn_terms_without_llm() -> None:
    result = parse_sec_424b2_structured_note(
        JPM_424B2_HTML,
        source_url="https://www.sec.gov/Archives/edgar/data/19617/000191870426014078/form424b2.htm",
        issuer_cik="0001665650",
        accession_number="0001918704-26-014078",
        parser_options={"allow_llm": True},
    )

    assert result["status"] == "PARSED"
    assert result["llm_used"] is False
    assert "external_llm_disabled_by_contract" in result["warnings"]
    assert result["note"]["issuer_cik"] == "0001665650"
    assert result["note"]["coupon_rate_annual"] == 0.135
    assert result["note"]["coupon_frequency"] == "Monthly"
    assert result["note"]["memory_feature"] is True
    assert result["note"]["payoff_type"] == "AUTO_CALLABLE_CONTINGENT_INTEREST_WORST_OF"
    assert result["note"]["underlying_tickers"] == ["NVDA", "MSFT", "TSLA"]
    assert {item["ticker"]: item["barrier_ratio"] for item in result["underlyings"]} == {
        "NVDA": 0.6,
        "MSFT": 0.6,
        "TSLA": 0.6,
    }
    assert result["note"]["evidence"]["coupon_rate_annual"]["table_index"] == 0
    assert result["underlyings"][0]["evidence"]["table_index"] == 1
    assert result["f2_contract"]["output_dimension"] == "note_date"
    assert result["f2_contract"]["production_llm_policy"] == "NO_LLM_PROD"
    assert "sandbox -> quarantine -> publish" == result["f2_contract"]["publish_boundary"]


def test_sec_424b2_parser_handles_label_drift_and_rowspan_tables() -> None:
    _, tables = parse_html_tables(BOFA_424B2_HTML)
    assert tables[1].rows[1][1] == "AAPL"

    result = parse_sec_424b2_structured_note(BOFA_424B2_HTML, issuer_cik="0000070858")

    assert result["status"] == "PARSED"
    assert result["note"]["coupon_rate_annual"] == 0.102
    assert result["note"]["underlying_tickers"] == ["AAPL"]
    assert result["underlyings"][0]["initial_value"] == 250.0
    assert result["underlyings"][0]["barrier_value"] == 150.0
    assert result["underlyings"][0]["barrier_ratio"] == 0.6


def test_sec_424b2_parser_prefers_strict_labeled_barrier_in_long_prose() -> None:
    result = parse_sec_424b2_structured_note(JPM_LONG_LABEL_424B2_HTML, issuer_cik="0001665650")

    assert result["status"] == "PARSED"
    assert result["note"]["coupon_rate_annual"] == 0.098
    assert result["note"]["barrier_percentage"] == 0.7
    assert result["note"]["underlying_tickers"] == ["RTY", "SPX", "KRE"]
    assert {item["ticker"]: item["barrier_ratio"] for item in result["underlyings"]} == {
        "RTY": 0.7,
        "SPX": 0.7,
        "KRE": 0.7,
    }
    assert {item["ticker"]: item["trigger_ratio"] for item in result["underlyings"]} == {
        "RTY": 0.6,
        "SPX": 0.6,
        "KRE": 0.6,
    }


def test_fcn_note_date_signal_contract_evaluates_worst_coupon_autocall_and_barrier_distance() -> None:
    parsed = parse_sec_424b2_structured_note(JPM_424B2_HTML, issuer_cik="0001665650")
    signals = evaluate_fcn_note_signals(
        parsed["note"],
        parsed["underlyings"],
        {"NVDA": 80.0, "MSFT": 140.0, "TSLA": 240.0},
        history_worst_performance=[0.72, 0.74, 0.76, 0.78, 0.80],
    )

    assert signals["status"] == "OK"
    assert signals["worst_performance"] == 0.7
    assert signals["coupon_eligible"] is True
    assert math.isclose(signals["coupon_signal"], 0.135 / 12)
    assert signals["autocall_trigger"] is False
    assert signals["distance_to_barrier"] is not None

    blocked = evaluate_fcn_note_signals(parsed["note"], parsed["underlyings"], {"NVDA": 80.0})
    assert blocked["status"] == "DATA_SOURCE_BLOCKED"
    assert set(blocked["missing_underlyings"]) == {"MSFT", "TSLA"}


def test_sec_provider_discovers_424b2_primary_document_archive_url(monkeypatch) -> None:
    provider = SecEdgarProvider(user_agent="Codex Test coder@example.com")

    def fake_request_json(url: str) -> dict:
        assert url.endswith("CIK0001665650.json")
        return {
            "filings": {
                "recent": {
                    "filingDate": ["2026-01-15", "2026-01-14"],
                    "form": ["424B2", "8-K"],
                    "accessionNumber": ["0001918704-26-014078", "0000000000-26-000001"],
                    "primaryDocument": ["form424b2.htm", "form8k.htm"],
                }
            }
        }

    monkeypatch.setattr(provider, "_request_json", fake_request_json)
    filings = provider.fetch_424b2_filings_by_cik("1665650")

    assert len(filings) == 1
    assert filings[0]["accession_number"] == "0001918704-26-014078"
    assert filings[0]["primary_document_url"].endswith("/000191870426014078/form424b2.htm")

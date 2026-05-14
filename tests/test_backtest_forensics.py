from __future__ import annotations

from grit_backtest_platform.backtest_forensics import (
    compare_backtest_runs,
    format_backtest_run_comparison_report,
)

from tests.api_test_support import create_grid_strategy, create_test_client


def _insert_persisted_run(
    service,
    *,
    run_id: str,
    strategy_id: str,
    request_start_date: str,
    effective_date: str,
    first_basket: list[str],
    source_run_id: str | None = None,
) -> None:
    parameter_snapshot = {
        "strategy_type": "MULTI_FACTOR",
        "factor_ids": ["s_vol_252d_rank", "s_alpha_ffblend_cur_rank"],
        "weights": [0.5, 0.5],
        "directions": ["LOW_IS_BETTER", "HIGH_IS_BETTER"],
        "rebalance_frequency": "semiannual",
        "scoring_method": "zscore_weighted",
        "neutralization": {
            "enabled": True,
            "method": "industry",
            "execution_status": "EXECUTED",
        },
    }
    environment_summary = {
        "benchmark_symbol": "SPY",
        "dataset_snapshot_id": "ds-price",
        "symbols": list(first_basket),
        "universe_name": "SP500",
        "universe_size": 503,
        "universe_snapshot_id": "un-sp500",
    }
    preview = {
        "effective_date": effective_date,
        "oos_start_date": "2018-03-24",
        "warnings": [],
        "parameter_snapshot": parameter_snapshot,
        "environment_summary": environment_summary,
        "multi_factor_precheck": {
            "status": "PASS",
            "factor_count": 2,
            "coverage_pct": 50.0,
            "blocked_factors": [],
            "neutralization_status": {
                "execution_status": "EXECUTED",
                "blockers": [],
            },
        },
    }
    trades = [
        {
            "trade_date": effective_date,
            "symbol": symbol,
            "action": "BUY",
            "weight_before": 0.0,
            "weight_after": 0.2,
        }
        for symbol in first_basket
    ] + [
        {
            "trade_date": "2007-10-31",
            "symbol": "SPY",
            "action": "SELL",
            "weight_before": 0.2,
            "weight_after": 0.0,
        }
    ]
    chart_series = [
        {
            "trade_date": effective_date,
            "equity": 1.0,
            "benchmark": 1.0,
            "strategy_return": 0.0,
            "benchmark_return": 0.0,
            "drawdown": 0.0,
            "is_oos": False,
        },
        {
            "trade_date": "2007-10-31",
            "equity": 1.05,
            "benchmark": 1.02,
            "strategy_return": 0.05,
            "benchmark_return": 0.02,
            "drawdown": -0.01,
            "is_oos": False,
        },
    ]
    request_payload = {
        "idempotency_key": f"run-{strategy_id}",
        "start_date": request_start_date,
        "end_date": "2026-03-24",
        "source_run_id": source_run_id,
        "fee_bps": 1.5,
        "slippage_bps": 2.5,
        "dataset_snapshot_id": "ds-price",
        "universe_snapshot_id": "un-sp500",
    }
    row = service._build_backtest_run_row(
        run_id=run_id,
        strategy_id=strategy_id,
        status="COMPLETED",
        request_payload=request_payload,
        created_at="2026-05-14T09:00:00Z",
        updated_at="2026-05-14T09:05:00Z",
        preview=preview,
        parameter_snapshot=parameter_snapshot,
        environment_summary=environment_summary,
        chart_series=chart_series,
        trades=trades,
        completed_at="2026-05-14T09:05:00Z",
    )
    service.storage.insert_json_row("backtest_runs", row)


def test_compare_backtest_runs_flags_same_effective_date_but_different_first_basket(tmp_path) -> None:
    client, db_path = create_test_client(tmp_path)
    strategy = create_grid_strategy(client, idempotency_key="materialize-grid-forensics")["strategy"]
    service = client.app.state.service

    _insert_persisted_run(
        service,
        run_id="run_forensics_a",
        strategy_id=strategy["id"],
        request_start_date="2006-03-24",
        effective_date="2007-04-27",
        first_basket=["ALB", "BKNG", "CF", "ICE", "MOS"],
    )
    _insert_persisted_run(
        service,
        run_id="run_forensics_b",
        strategy_id=strategy["id"],
        request_start_date="2007-04-27",
        effective_date="2007-04-27",
        first_basket=["GE", "GPC", "IBM", "JNJ", "NKE"],
        source_run_id="run_forensics_source",
    )
    service.storage.execute(
        "UPDATE backtest_runs SET deleted_at = ? WHERE id = ?",
        ("2026-05-14T07:03:19Z", "run_forensics_b"),
    )

    report = compare_backtest_runs(db_path, "run_forensics_a", "run_forensics_b")
    comparison = report["comparison"]

    assert comparison["shared_effective_date"] is True
    assert comparison["same_rebalance_schedule"] is True
    assert comparison["same_first_basket"] is False
    assert comparison["same_parameter_signature"] is True
    assert comparison["same_precheck_signature"] is True
    assert report["run_a"]["first_basket_symbols"] == ["ALB", "BKNG", "CF", "ICE", "MOS"]
    assert report["run_b"]["first_basket_symbols"] == ["GE", "GPC", "IBM", "JNJ", "NKE"]
    assert report["run_b"]["deleted_at"] == "2026-05-14T07:03:19Z"

    heuristic_codes = [item["code"] for item in comparison["heuristics"]]
    assert "DATE_WINDOW_MISMATCH" in heuristic_codes
    assert "SOURCE_RUN_CHAIN_PRESENT" in heuristic_codes
    assert "HISTORICAL_ENGINE_OR_DATA_DRIFT" in heuristic_codes
    assert any(
        "engine_version" in item
        for item in comparison["persisted_evidence_gaps"]
    )


def test_format_backtest_run_comparison_report_includes_first_basket_and_heuristics(tmp_path) -> None:
    client, db_path = create_test_client(tmp_path)
    strategy = create_grid_strategy(client, idempotency_key="materialize-grid-forensics-format")["strategy"]
    service = client.app.state.service

    _insert_persisted_run(
        service,
        run_id="run_format_a",
        strategy_id=strategy["id"],
        request_start_date="2006-03-24",
        effective_date="2007-04-27",
        first_basket=["ALB", "BKNG", "CF", "ICE", "MOS"],
    )
    _insert_persisted_run(
        service,
        run_id="run_format_b",
        strategy_id=strategy["id"],
        request_start_date="2007-04-27",
        effective_date="2007-04-27",
        first_basket=["GE", "GPC", "IBM", "JNJ", "NKE"],
    )

    report = compare_backtest_runs(db_path, "run_format_a", "run_format_b")
    text = format_backtest_run_comparison_report(report)

    assert "Run A: run_format_a" in text
    assert "Run B: run_format_b" in text
    assert "first_basket: ALB, BKNG, CF, ICE, MOS" in text
    assert "first_basket: GE, GPC, IBM, JNJ, NKE" in text
    assert "HISTORICAL_ENGINE_OR_DATA_DRIFT" in text

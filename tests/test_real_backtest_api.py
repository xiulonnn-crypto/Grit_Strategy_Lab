from __future__ import annotations

from grit_backtest_platform.backtest_metrics import build_drawdown_events, build_relative_metrics

from tests.api_test_support import (
    assert_ok,
    create_grid_strategy,
    create_test_client,
    preview_backtest,
    refresh_snapshots,
    submit_backtest,
)


START_DATE = "2024-03-01"
END_DATE = "2025-03-31"


def test_preview_submit_detail_and_trades_preserve_parameter_snapshot_and_default_segment(tmp_path):
    client, _ = create_test_client(tmp_path)

    strategy = create_grid_strategy(client, idempotency_key="materialize-grid-real")["strategy"]
    refresh = refresh_snapshots(client)
    preview = preview_backtest(client, strategy["id"], start_date=START_DATE, end_date=END_DATE)
    submitted = submit_backtest(
        client,
        strategy["id"],
        start_date=START_DATE,
        end_date=END_DATE,
        idempotency_key="run-grid-default-segment",
    )
    detail = assert_ok(client.get(f"/backtest-runs/{submitted['id']}/detail"))
    trades = assert_ok(client.get(f"/backtest-runs/{submitted['id']}/trades"))

    assert refresh["summary"]["status"] == "READY"
    assert preview["data_segment_type"] == "FULL"
    assert preview["parameter_snapshot"]["initial_position"] == 10
    assert submitted["data_segment_type"] == "FULL"
    assert submitted["request"]["data_segment_type"] == "FULL"
    assert submitted["is_permanent"] is True
    assert submitted["parameter_snapshot"] == preview["parameter_snapshot"]
    assert detail["data_segment_type"] == "FULL"
    assert detail["snapshot_summary"]["status"] == "READY"
    assert trades["total"] == detail["trades_count"]
    assert detail["trade_audit_items"]
    assert set(detail["trade_audit_items"][0].keys()) == {
        "trade_id",
        "symbol",
        "segment",
        "opened_at",
        "closed_at",
        "pnl_pct",
        "max_favorable_excursion_pct",
        "max_adverse_excursion_pct",
        "slippage_cost_pct",
        "commentary",
    }


def test_trade_audit_endpoint_returns_price_context_and_risk_evaluation(tmp_path):
    client, _ = create_test_client(tmp_path)

    strategy = create_grid_strategy(client, idempotency_key="materialize-grid-audit-endpoint")["strategy"]
    refresh_snapshots(client)
    submitted = submit_backtest(
        client,
        strategy["id"],
        start_date=START_DATE,
        end_date=END_DATE,
        idempotency_key="run-grid-audit-endpoint",
    )
    detail = assert_ok(client.get(f"/backtest-runs/{submitted['id']}/detail"))
    trade_id = detail["trade_audit_items"][0]["trade_id"]

    audit = assert_ok(client.get(f"/backtest-runs/{submitted['id']}/trades/{trade_id}/audit"))

    assert set(audit.keys()) == {
        "trade_id",
        "symbol",
        "segment",
        "opened_at",
        "closed_at",
        "pnl_pct",
        "max_favorable_excursion_pct",
        "max_adverse_excursion_pct",
        "slippage_cost_pct",
        "commentary",
        "price_series",
        "trigger_snapshot",
        "risk_evaluation",
        "entry_marker",
        "exit_marker",
        "chart_band",
    }
    assert audit["trade_id"] == trade_id
    assert audit["price_series"]
    assert set(audit["price_series"][0].keys()) == {"date", "open", "high", "low", "close", "adj_close", "volume"}
    assert set(audit["trigger_snapshot"].keys()) == {
        "symbol",
        "template_key",
        "lookback_days",
        "rebalance_frequency",
        "parameter_version_id",
        "entry_weight_after",
        "signal_score",
        "reason",
    }
    assert set(audit["risk_evaluation"].keys()) == {
        "max_favorable_excursion_pct",
        "max_adverse_excursion_pct",
        "mfe_mae_ratio",
        "slippage_cost_pct",
        "commentary",
    }
    assert audit["entry_marker"]["date"] == audit["opened_at"]
    assert audit["exit_marker"]["date"] == audit["closed_at"]
    assert audit["chart_band"]["start_date"] == audit["opened_at"]
    assert audit["chart_band"]["end_date"] == audit["closed_at"]


def test_clone_backtest_run_defaults_to_temporary_and_preserves_source_run_id(tmp_path):
    client, _ = create_test_client(tmp_path)

    strategy = create_grid_strategy(client, idempotency_key="materialize-grid-clone-temp")["strategy"]
    refresh_snapshots(client)
    submitted = submit_backtest(
        client,
        strategy["id"],
        start_date=START_DATE,
        end_date=END_DATE,
        idempotency_key="run-grid-clone-source",
    )

    cloned = assert_ok(
        client.post(
            f"/backtest-runs/{submitted['id']}/clone",
            json={"idempotency_key": "clone-grid-temp"},
        )
    )

    assert cloned["source_run_id"] == submitted["id"]
    assert cloned["is_permanent"] is False


def test_backtest_run_detail_round_trips_explicit_data_segment_type(tmp_path):
    client, _ = create_test_client(tmp_path)

    strategy = create_grid_strategy(client, idempotency_key="materialize-grid-train")["strategy"]
    refresh_snapshots(client)

    preview = preview_backtest(
        client,
        strategy["id"],
        start_date=START_DATE,
        end_date=END_DATE,
        data_segment_type="TRAIN",
    )
    submitted = submit_backtest(
        client,
        strategy["id"],
        start_date=START_DATE,
        end_date=END_DATE,
        data_segment_type="TRAIN",
        idempotency_key="run-grid-train-segment",
    )
    detail = assert_ok(client.get(f"/backtest-runs/{submitted['id']}/detail"))

    assert preview["data_segment_type"] == "TRAIN"
    assert submitted["data_segment_type"] == "TRAIN"
    assert submitted["preview"]["data_segment_type"] == "TRAIN"
    assert submitted["request"]["data_segment_type"] == "TRAIN"
    assert detail["data_segment_type"] == "TRAIN"


def test_backtest_run_detail_matches_relative_and_drawdown_metric_builders(tmp_path):
    client, _ = create_test_client(tmp_path)

    strategy = create_grid_strategy(client, idempotency_key="materialize-grid-metrics")["strategy"]
    refresh_snapshots(client)
    submitted = submit_backtest(
        client,
        strategy["id"],
        start_date=START_DATE,
        end_date=END_DATE,
        idempotency_key="run-grid-metric-audit",
    )
    detail = assert_ok(client.get(f"/backtest-runs/{submitted['id']}/detail"))

    expected_relative_metrics = build_relative_metrics(detail["chart_series"])
    expected_drawdown_events = build_drawdown_events(detail["chart_series"], detail["oos_start_date"])

    assert detail["relative_metrics"] == expected_relative_metrics
    assert set(detail["relative_metrics"].keys()) == {"alpha_proxy", "average_excess_return", "capture_ratio"}
    assert detail["drawdown_events"] == expected_drawdown_events
    if detail["drawdown_events"]:
        assert set(detail["drawdown_events"][0].keys()) == {
            "start_date",
            "trough_date",
            "drawdown_pct",
            "recovery_date",
            "status",
            "segment",
        }

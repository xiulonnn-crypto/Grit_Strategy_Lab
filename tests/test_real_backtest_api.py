from __future__ import annotations

import json

from grit_backtest_platform.backtest_metrics import (
    build_drawdown_events,
    build_relative_metrics,
    build_run_detail_analysis,
)

from tests.api_test_support import (
    assert_ok,
    create_buy_and_hold_strategy,
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

    assert refresh["overall_status"] == "READY"
    assert refresh["latest_job"]["summary"]["status"] == "READY"
    assert preview["data_segment_type"] == "FULL"
    assert preview["dataset_snapshot_id"] == "ds-price"
    assert preview["universe_snapshot_id"] is None
    assert preview["warnings"] == []
    assert preview["parameter_snapshot"]["initial_position"] == 10
    assert submitted["data_segment_type"] == "FULL"
    assert submitted["request"]["data_segment_type"] == "FULL"
    assert submitted["request"]["dataset_snapshot_id"] == "ds-price"
    assert submitted["request"]["universe_snapshot_id"] is None
    assert submitted["request"]["execution_policy"] == "T_CLOSE_TO_T1_OPEN"
    assert submitted["is_permanent"] is True
    assert submitted["parameter_snapshot"] == preview["parameter_snapshot"]
    assert detail["data_segment_type"] == "FULL"
    assert detail["dataset_snapshot_id"] == "ds-price"
    assert detail["universe_snapshot_id"] is None
    assert detail["snapshot_summary"]["status"] == "READY"
    assert trades["total"] == detail["trades_count"]
    assert detail["coverage_ratio"] > 0.9
    assert trades["items"][0]["trade_date"] == START_DATE
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
    assert all(abs(event["drawdown_pct"]) <= 100 for event in detail["drawdown_events"])


def test_backtest_run_detail_backfills_missing_execution_policy_for_legacy_runs(tmp_path):
    client, _ = create_test_client(tmp_path)

    strategy = create_grid_strategy(client, idempotency_key="materialize-grid-legacy-policy")["strategy"]
    refresh_snapshots(client)
    submitted = submit_backtest(
        client,
        strategy["id"],
        start_date=START_DATE,
        end_date=END_DATE,
        idempotency_key="run-grid-legacy-policy",
    )
    service = client.app.state.service
    legacy_request = dict(submitted["request"])
    legacy_request["execution_policy"] = None
    service.storage.execute(
        "UPDATE backtest_runs SET request_json = ? WHERE id = ?",
        (json.dumps(legacy_request), submitted["id"]),
    )

    detail = assert_ok(client.get(f"/backtest-runs/{submitted['id']}/detail"))

    assert detail["request"]["execution_policy"] == "T_CLOSE_TO_T1_OPEN"
    assert detail["preview"]["execution_policy"] == "T_CLOSE_TO_T1_OPEN"


def test_single_symbol_preview_submit_bypasses_incomplete_universe_and_corporate_snapshots(tmp_path):
    client, _ = create_test_client(tmp_path)

    strategy = create_grid_strategy(
        client,
        idempotency_key="materialize-grid-single-symbol",
        benchmark_symbol="QQQ",
    )["strategy"]
    refresh_snapshots(client)
    service = client.app.state.service
    repository = service.market_data_repository

    assert_ok(client.patch(f"/strategies/{strategy['id']}", json={"universe_snapshot_id": "un-ndx100"}))

    corporate_snapshot = next(
        item for item in repository.list_dataset_snapshots() if item["id"] == "ds-corporate-actions"
    )
    corporate_rows = repository.load_dataset_snapshot_rows("ds-corporate-actions")
    repository.replace_dataset_snapshot(
        {
            **dict(corporate_snapshot),
            "status": "INCOMPLETE",
            "blocker": {
                "code": "CORPORATE_ACTIONS_INCOMPLETE",
                "message": "公司行为数据已部分可用，但仍有事件缺口待修复。",
            },
        },
        corporate_actions=corporate_rows.get("corporate_actions") or [],
        symbol_coverage=corporate_rows.get("symbol_coverage") or [],
    )

    universe_snapshot = next(item for item in repository.list_universe_snapshots() if item["id"] == "un-ndx100")
    universe_memberships = repository.load_universe_memberships(universe_snapshot_id="un-ndx100")
    repository.replace_universe_snapshot(
        {
            **dict(universe_snapshot),
            "status": "INCOMPLETE",
            "blocker": {
                "code": "UNIVERSE_HISTORY_INCOMPLETE",
                "message": "股票池历史成分仍在补齐，当前还不能视为完整的点时成分快照。",
            },
        },
        memberships=universe_memberships,
    )

    detail = assert_ok(client.get(f"/strategies/{strategy['id']}/detail"))
    assert detail["universe_snapshot_id"] is None

    preview = preview_backtest(client, strategy["id"], start_date=START_DATE, end_date=END_DATE)
    assert preview["universe_snapshot_id"] is None
    assert preview["environment_summary"]["symbols"] == ["QQQ"]
    assert preview["snapshot_summary"]["status"] == "READY"
    assert preview["snapshot_summary"]["blocking"] is False
    assert preview["snapshot_summary"]["corporate_actions_status"] == "INCOMPLETE"
    assert preview["snapshot_summary"]["universe_status"] == "NOT_REQUIRED"

    submitted = submit_backtest(
        client,
        strategy["id"],
        start_date=START_DATE,
        end_date=END_DATE,
        idempotency_key="run-grid-single-symbol",
    )
    assert submitted["request"]["universe_snapshot_id"] is None
    assert submitted["preview"]["snapshot_summary"]["blocking"] is False
    assert submitted["preview"]["environment_summary"]["symbols"] == ["QQQ"]


def test_single_symbol_preview_submit_ignores_global_price_snapshot_incomplete_when_requested_symbols_exist(tmp_path):
    client, _ = create_test_client(tmp_path)

    strategy = create_grid_strategy(
        client,
        idempotency_key="materialize-grid-price-status-only",
        benchmark_symbol="SPY",
    )["strategy"]
    refresh_snapshots(client)
    service = client.app.state.service
    repository = service.market_data_repository

    price_snapshot = next(item for item in repository.list_dataset_snapshots() if item["id"] == "ds-price")
    price_rows = repository.load_dataset_snapshot_rows("ds-price")
    repository.replace_dataset_snapshot(
        {
            **dict(price_snapshot),
            "status": "INCOMPLETE",
            "blocker": {
                "code": "PRICE_SNAPSHOT_INCOMPLETE",
                "message": "Some unrelated symbols are still missing from the global price snapshot.",
            },
        },
        price_bars=price_rows.get("price_bars") or [],
        symbol_coverage=price_rows.get("symbol_coverage") or [],
    )

    preview = preview_backtest(client, strategy["id"], start_date=START_DATE, end_date=END_DATE)
    assert preview["environment_summary"]["symbols"] == ["QQQ"]
    assert preview["snapshot_summary"]["price_dataset_status"] == "INCOMPLETE"
    assert preview["snapshot_summary"]["status"] == "READY"
    assert preview["snapshot_summary"]["blocking"] is False

    submitted = submit_backtest(
        client,
        strategy["id"],
        start_date=START_DATE,
        end_date=END_DATE,
        idempotency_key="run-grid-price-status-only",
    )
    assert submitted["preview"]["snapshot_summary"]["price_dataset_status"] == "INCOMPLETE"
    assert submitted["preview"]["snapshot_summary"]["blocking"] is False
    assert submitted["preview"]["environment_summary"]["symbols"] == ["QQQ"]


def test_buy_and_hold_dca_preview_submit_generates_recurring_monthly_trades(tmp_path):
    client, _ = create_test_client(tmp_path)

    strategy = create_buy_and_hold_strategy(
        client,
        idempotency_key="materialize-buy-and-hold-dca",
        benchmark_symbol="QQQ",
        contribution_amount=1000,
        investment_frequency="monthly",
    )["strategy"]
    refresh_snapshots(client)

    preview = preview_backtest(client, strategy["id"], start_date=START_DATE, end_date=END_DATE)
    submitted = submit_backtest(
        client,
        strategy["id"],
        start_date=START_DATE,
        end_date=END_DATE,
        idempotency_key="run-buy-and-hold-dca",
    )
    detail = assert_ok(client.get(f"/backtest-runs/{submitted['id']}/detail"))
    trades = assert_ok(client.get(f"/backtest-runs/{submitted['id']}/trades?page=1&page_size=100"))

    assert preview["parameter_snapshot"]["contribution_amount"] == 1000
    assert preview["parameter_snapshot"]["investment_frequency"] == "monthly"
    assert detail["trades_count"] == trades["total"]
    assert detail["trades_count"] > 10
    assert trades["items"][0]["trade_date"] == START_DATE
    assert all(item["reason"] == "buy_and_hold:monthly" for item in trades["items"])
    total_return_card = next(card for card in detail["analysis"]["kpi_cards"] if card["key"] == "total_return")
    sharpe_card = next(card for card in detail["analysis"]["kpi_cards"] if card["key"] == "sharpe")
    assert total_return_card["primary_text"] != total_return_card["compare_text"].split(" | ")[0].replace("基准: ", "")
    assert "| 差值: -0.0%" not in total_return_card["compare_text"]
    assert "| 差值: +0.00" not in sharpe_card["compare_text"]


def test_grid_materialize_uses_session_name_description_and_benchmark(tmp_path):
    client, _ = create_test_client(tmp_path)

    strategy = create_grid_strategy(
        client,
        idempotency_key="materialize-grid-session-fields",
        strategy_name="QQQ 自定义网格策略",
        strategy_description="围绕QQQ执行网格买卖。",
        benchmark_symbol="SPY",
    )["strategy"]

    assert strategy["name"] == "QQQ 自定义网格策略"
    assert strategy["description"] == "围绕QQQ执行网格买卖。"
    assert strategy["benchmark_symbol"] == "SPY"


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


def test_backtest_run_detail_includes_analysis_contract_with_derived_kpis(tmp_path):
    client, _ = create_test_client(tmp_path)

    strategy = create_grid_strategy(client, idempotency_key="materialize-grid-analysis-contract")["strategy"]
    refresh_snapshots(client)
    submitted = submit_backtest(
        client,
        strategy["id"],
        start_date=START_DATE,
        end_date=END_DATE,
        idempotency_key="run-grid-analysis-contract",
    )
    detail = assert_ok(client.get(f"/backtest-runs/{submitted['id']}/detail"))

    expected_analysis = build_run_detail_analysis(detail)
    analysis = detail["analysis"]
    total_return_card = next(card for card in analysis["kpi_cards"] if card["key"] == "total_return")

    benchmark_total_return = (
        float(detail["chart_series"][-1]["benchmark"]) / float(detail["chart_series"][0]["benchmark"]) - 1.0
        if detail["chart_series"] and float(detail["chart_series"][0]["benchmark"])
        else 0.0
    )

    assert analysis == expected_analysis
    assert isinstance(analysis["subtitle"], str) and analysis["subtitle"]
    assert len(analysis["kpi_cards"]) == 5
    assert set(total_return_card.keys()) == {
        "key",
        "label",
        "primary_text",
        "trend_direction",
        "trend_text",
        "compare_text",
        "insight_text",
        "insight_tone",
        "state",
    }
    assert f"基准: {benchmark_total_return * 100.0:+.1f}%" in total_return_card["compare_text"]
    assert 0 <= analysis["decision_rail"]["score"] <= 100
    assert [item["key"] for item in analysis["decision_rail"]["items"]] == [
        "result_judgement",
        "risk_judgement",
        "next_action",
    ]

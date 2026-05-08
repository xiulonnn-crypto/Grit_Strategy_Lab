from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from fastapi.testclient import TestClient


def _bootstrap_repo(repo_root: Path) -> None:
    root_text = str(repo_root)
    src_text = str(repo_root / "src")
    if root_text not in sys.path:
        sys.path.insert(0, root_text)
    if src_text not in sys.path:
        sys.path.insert(0, src_text)


def _build_fixture(output_dir: Path) -> dict[str, str]:
    from grit_backtest_platform.api import create_app
    from tests.api_test_support import (
        FakeMarketDataProvider,
        assert_ok,
        create_optimization_job,
        draft_strategy_session,
        grid_confirmation_payload,
        materialize_session,
        preview_backtest,
        refresh_snapshots,
        submit_backtest,
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    workspace_db = output_dir / "seed_workspace.sqlite3"
    market_data_db = output_dir / "seed_workspace_market_data.sqlite3"
    manifest_path = output_dir / "manifest.json"

    for path in (workspace_db, market_data_db, manifest_path):
        if path.exists():
            path.unlink()

    previous_pytest_marker = os.environ.get("PYTEST_CURRENT_TEST")
    os.environ["PYTEST_CURRENT_TEST"] = "seed-fixture-build"
    try:
        with TestClient(create_app(workspace_db, market_data_provider=FakeMarketDataProvider())) as client:
            refresh_overview = refresh_snapshots(
                client,
                reason="seed-fixture-build",
                mode="repair",
                targets=["price", "corporate", "universes"],
            )
            overall_status = str(refresh_overview.get("overall_status") or "").upper()
            if overall_status != "READY":
                raise RuntimeError(
                    f"Snapshot refresh did not reach READY status; received {overall_status or '<empty>'}."
                )

            creation_session = draft_strategy_session(
                client,
                strategy_type="GRID",
                message="Create a codex harness draft grid strategy for QQQ.",
                confirmation_payload=grid_confirmation_payload(
                    revision=1,
                    universe_name="QQQ",
                    strategy_name="Codex GRID Draft",
                    strategy_description="Draft strategy reserved for the Codex harness creation-session route.",
                    benchmark_symbol="SPY",
                    rebalance_frequency="never",
                    initial_position=20,
                    grid_interval=5,
                    buy_size_pct=10,
                    sell_step_pct=10,
                    sell_size_pct=10,
                    max_stop_loss_pct=-4,
                    capital=100000,
                ),
            )

            detail_strategy_session = draft_strategy_session(
                client,
                strategy_type="GRID",
                message="Create a codex harness materialized grid strategy for live smoke coverage.",
                confirmation_payload=grid_confirmation_payload(
                    revision=1,
                    universe_name="QQQ",
                    strategy_name="Codex GRID Strategy",
                    strategy_description="Materialized grid strategy reserved for live smoke coverage.",
                    benchmark_symbol="SPY",
                    rebalance_frequency="never",
                    initial_position=20,
                    grid_interval=5,
                    buy_size_pct=10,
                    sell_step_pct=10,
                    sell_size_pct=10,
                    max_stop_loss_pct=-4,
                    capital=100000,
                ),
            )
            detail_strategy = assert_ok(
                materialize_session(
                    client,
                    detail_strategy_session["session_id"],
                    idempotency_key="seed-grid-materialize",
                )
            )

            preview_backtest(
                client,
                detail_strategy["id"],
                start_date="2025-01-01",
                end_date="2026-03-31",
            )
            run = submit_backtest(
                client,
                detail_strategy["id"],
                start_date="2025-01-01",
                end_date="2026-03-31",
                idempotency_key="seed-grid-run",
            )

            optimization_strategy_session = draft_strategy_session(
                client,
                strategy_type="MEAN_REVERSION",
                message="Create a codex harness mean reversion strategy for optimization coverage.",
                confirmation_payload={
                    "revision": 1,
                    "strategy_type": "MEAN_REVERSION",
                    "core": {
                        "universe_name": "SPY",
                        "rebalance_frequency": "never",
                    },
                    "logic": {},
                    "parameters": {
                        "strategy_name": "Codex MOM Strategy",
                        "strategy_description": (
                            "Mean reversion strategy reserved for optimization coverage "
                            "in the Codex harness."
                        ),
                        "benchmark_symbol": "SPY",
                        "observation_timeframe": "daily",
                        "trading_logic": "Daily SPY mean reversion harness strategy.",
                        "bollinger_period": 20,
                        "rsi_period": 6,
                        "rsi_buy_threshold": 30,
                        "rsi_sell_threshold": 70,
                        "atr_period": 14,
                        "take_profit_atr": 1.5,
                        "stop_loss_atr": 1.0,
                        "long_entry_size_pct": 50,
                        "short_entry_size_pct": 0,
                        "capital": 100000,
                    },
                },
            )
            optimization_strategy = assert_ok(
                materialize_session(
                    client,
                    optimization_strategy_session["session_id"],
                    idempotency_key="seed-momentum-materialize",
                )
            )
            preview_backtest(
                client,
                optimization_strategy["id"],
                start_date="2025-01-01",
                end_date="2026-03-31",
            )
            optimization_source_run = submit_backtest(
                client,
                optimization_strategy["id"],
                start_date="2025-01-01",
                end_date="2026-03-31",
                idempotency_key="seed-optimization-source-run",
            )
            optimization_job = create_optimization_job(
                client,
                optimization_strategy["id"],
                base_parameter_version_id=optimization_strategy.get("current_parameter_version_id"),
                source_run_id=optimization_source_run["id"],
                objective="sharpe",
                budget_combinations=6,
                search_space=[
                    {
                        "key": "observation_timeframe",
                        "label": "Observation timeframe",
                        "mode": "discrete",
                        "current": "daily",
                        "value": "daily",
                        "values": ["daily", "weekly", "monthly"],
                        "tag": "Core parameter",
                    },
                    {
                        "key": "bollinger_period",
                        "label": "Bollinger period",
                        "mode": "range",
                        "current": 20,
                        "start": 18,
                        "end": 22,
                        "step": 2,
                        "tag": "Signal parameter",
                    },
                    {
                        "key": "rsi_buy_threshold",
                        "label": "RSI buy threshold",
                        "mode": "range",
                        "current": 30,
                        "start": 25,
                        "end": 35,
                        "step": 5,
                        "tag": "Entry parameter",
                    },
                    {
                        "key": "rsi_sell_threshold",
                        "label": "RSI sell threshold",
                        "mode": "fixed",
                        "current": 70,
                        "value": 70,
                        "start": 70,
                        "end": 70,
                        "step": 1,
                        "tag": "Fixed parameter",
                    },
                ],
                wait_until_complete=True,
                timeout_seconds=10.0,
            )

            workspace = assert_ok(client.get("/workspace/overview"))
            run_detail = assert_ok(client.get(f"/backtest-runs/{run['id']}/detail"))
            job_detail = assert_ok(client.get(f"/optimization-jobs/{optimization_job['id']}/detail"))
            strategy_detail = assert_ok(client.get(f"/strategies/{detail_strategy['id']}/detail"))
            config_strategy_detail = assert_ok(client.get(f"/strategies/{optimization_strategy['id']}/detail"))
            creation_detail = assert_ok(client.get(f"/strategy-creation-sessions/{creation_session['session_id']}"))

            if str(run.get("status") or "").upper() not in {"COMPLETED", "COMPLETED_WITH_WARNINGS"}:
                raise RuntimeError(f"Seed backtest did not complete successfully: {run.get('status')!r}")
            if str(optimization_job.get("status") or "").upper() != "COMPLETED":
                raise RuntimeError(
                    f"Seed optimization job did not complete successfully: {optimization_job.get('status')!r}"
                )
            if str(optimization_source_run.get("status") or "").upper() not in {"COMPLETED", "COMPLETED_WITH_WARNINGS"}:
                raise RuntimeError(
                    f"Seed optimization source run did not complete successfully: {optimization_source_run.get('status')!r}"
                )
            if not workspace.get("latest_backtest_run_id"):
                raise RuntimeError("Workspace overview is missing latest_backtest_run_id after seed generation.")
            if not run_detail.get("id"):
                raise RuntimeError("Backtest run detail was not retrievable after seed generation.")
            if not job_detail.get("id"):
                raise RuntimeError("Optimization job detail was not retrievable after seed generation.")
            job_request = job_detail.get("request") or {}
            if not job_request.get("source_run_id"):
                raise RuntimeError("Optimization job fixture is missing source_run_id for baseline comparison.")
            if not any(
                str(entry.get("key")) == "observation_timeframe"
                for entry in job_request.get("search_space") or []
                if isinstance(entry, dict)
            ):
                raise RuntimeError("Optimization job fixture is missing observation_timeframe search coverage.")
            if not strategy_detail.get("id"):
                raise RuntimeError("Strategy detail was not retrievable after seed generation.")
            if not config_strategy_detail.get("id"):
                raise RuntimeError("Optimization strategy detail was not retrievable after seed generation.")
            if not creation_detail.get("id"):
                raise RuntimeError("Creation session detail was not retrievable after seed generation.")
    finally:
        if previous_pytest_marker is None:
            os.environ.pop("PYTEST_CURRENT_TEST", None)
        else:
            os.environ["PYTEST_CURRENT_TEST"] = previous_pytest_marker

    manifest = {
        "db_filename": workspace_db.name,
        "market_data_db_filename": market_data_db.name,
        "creation_session_id": creation_session["session_id"],
        "strategy_id": detail_strategy["id"],
        "optimization_strategy_id": optimization_strategy["id"],
        "optimization_source_run_id": optimization_source_run["id"],
        "run_id": run["id"],
        "optimization_job_id": optimization_job["id"],
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate the committed Codex seed fixture workspace.")
    parser.add_argument(
        "--output-dir",
        default="harness/fixtures/seed_workspace",
        help="Directory that will receive the fixture databases and manifest.",
    )
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    _bootstrap_repo(repo_root)
    output_dir = (repo_root / args.output_dir).resolve()
    manifest = _build_fixture(output_dir)
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

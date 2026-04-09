from __future__ import annotations

from tests.api_test_support import create_grid_strategy, create_test_client, refresh_snapshots, submit_backtest


START_DATE = "2024-03-01"
END_DATE = "2025-03-31"


def test_strategy_run_refs_ignore_deleted_runs_and_cleanup_stale_pointers(tmp_path):
    client, _ = create_test_client(tmp_path)

    strategy = create_grid_strategy(client, idempotency_key="materialize-grid-stale-run-refs")["strategy"]
    refresh_snapshots(client)
    submitted = submit_backtest(
        client,
        strategy["id"],
        start_date=START_DATE,
        end_date=END_DATE,
        idempotency_key="run-grid-stale-run-refs",
    )

    service = client.app.state.service
    stale_run_id = submitted["id"]
    stale_created_at = "2026-04-01T00:00:00Z"
    service.storage.execute(
        """
        UPDATE backtest_runs
        SET created_at = ?, completed_at = ?, updated_at = ?
        WHERE id = ?
        """,
        (stale_created_at, stale_created_at, stale_created_at, stale_run_id),
    )

    removed = service.purge_expired_temporary_runs()
    assert removed == 1

    strategy_row = service.storage.fetch_one(
        "SELECT latest_run_id, latest_successful_run_id FROM strategies WHERE id = ?",
        (strategy["id"],),
    )
    assert strategy_row["latest_run_id"] is None
    assert strategy_row["latest_successful_run_id"] is None

    service.storage.execute(
        """
        UPDATE strategies
        SET latest_run_id = ?, latest_successful_run_id = ?
        WHERE id = ?
        """,
        (stale_run_id, stale_run_id, strategy["id"]),
    )

    strategy_list_item = next(item for item in service.list_strategies() if item["id"] == strategy["id"])
    strategy_detail = service.get_strategy_detail(strategy["id"])

    assert strategy_list_item["latest_run_id"] is None
    assert strategy_list_item["latest_successful_run_id"] is None
    assert strategy_detail["latest_run_id"] is None
    assert strategy_detail["latest_successful_run_id"] is None

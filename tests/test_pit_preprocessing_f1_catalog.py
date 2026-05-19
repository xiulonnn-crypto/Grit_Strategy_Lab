from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from tests.api_test_support import assert_ok, create_test_client


def _runtime_dir(name: str) -> Path:
    path = Path(".tmp") / "pytest-runtime" / f"{name}-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _seed_price_snapshot_with_l1_gap(client) -> None:
    repository = client.app.state.service.market_data_repository
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "股票价格数据",
            "status": "READY",
            "as_of": "2024-01-02",
            "freshness_label": "单元测试 PIT 快照",
            "start_date": "2024-01-02",
            "end_date": "2024-01-02",
            "row_count": 1,
            "source": "unit_test_runtime_price",
            "fallback_source": "none",
            "metadata": {
                "covered_symbol_count": 1,
                "total_symbol_count": 2,
                "missing_symbols": ["MSFT"],
            },
        },
        price_bars=[
            {
                "symbol": "AAPL",
                "date": "2024-01-02",
                "open": 100.0,
                "high": 101.0,
                "low": 99.0,
                "close": 100.5,
                "adj_close": 100.5,
                "volume": 1_000_000,
                "source": "unit_test_runtime_price",
                "fallback_source": "none",
            }
        ],
        symbol_coverage=[
            {
                "symbol": "AAPL",
                "start_date": "2024-01-02",
                "end_date": "2024-01-02",
                "status": "READY",
                "row_count": 1,
                "source": "unit_test_runtime_price",
                "fallback_source": "none",
                "metadata": {"coverage_kind": "price_daily"},
            }
        ],
    )


def _seed_price_snapshot_with_archival_gap_and_10y_ready(client) -> None:
    repository = client.app.state.service.market_data_repository
    repository.replace_universe_snapshot(
        {
            "id": "un-sp500",
            "universe_key": "SP500",
            "name": "S&P 500",
            "status": "READY",
            "as_of": "2026-05-19",
            "freshness_label": "单元测试 10Y 样本池",
            "window_start": "2016-05-19",
            "window_end": "2026-05-19",
            "anchor_schedule": "unit",
            "member_count": 2,
            "source": "unit_test_universe",
            "fallback_source": "none",
            "metadata": {"coverage_mode": "point_in_time_anchor"},
        },
        memberships=[
            {
                "effective_date": "2017-01-01",
                "symbol": "AAPL",
                "source": "unit_test_universe",
                "fallback_source": "none",
                "metadata": {},
            },
            {
                "effective_date": "2026-05-19",
                "symbol": "MSFT",
                "source": "unit_test_universe",
                "fallback_source": "none",
                "metadata": {},
            },
        ],
    )
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "股票价格数据",
            "status": "INCOMPLETE",
            "as_of": "2026-05-19",
            "freshness_label": "单元测试 PIT 快照",
            "start_date": "2016-05-19",
            "end_date": "2026-05-19",
            "row_count": 2,
            "source": "unit_test_runtime_price",
            "fallback_source": "none",
            "metadata": {
                "covered_symbol_count": 2,
                "total_symbol_count": 3,
                "missing_symbols": ["ZZZZ"],
            },
        },
        price_bars=[
            {
                "symbol": "AAPL",
                "date": "2026-05-19",
                "open": 100.0,
                "high": 101.0,
                "low": 99.0,
                "close": 100.5,
                "adj_close": 100.5,
                "volume": 1_000_000,
                "source": "unit_test_runtime_price",
                "fallback_source": "none",
            },
            {
                "symbol": "MSFT",
                "date": "2026-05-19",
                "open": 200.0,
                "high": 202.0,
                "low": 198.0,
                "close": 201.0,
                "adj_close": 201.0,
                "volume": 2_000_000,
                "source": "unit_test_runtime_price",
                "fallback_source": "none",
            },
        ],
        symbol_coverage=[
            {
                "symbol": "AAPL",
                "start_date": "2016-05-19",
                "end_date": "2026-05-19",
                "status": "READY",
                "row_count": 2520,
                "source": "unit_test_runtime_price",
                "fallback_source": "none",
                "metadata": {"coverage_kind": "price_daily"},
            },
            {
                "symbol": "MSFT",
                "start_date": "2016-05-19",
                "end_date": "2026-05-19",
                "status": "READY",
                "row_count": 2520,
                "source": "unit_test_runtime_price",
                "fallback_source": "none",
                "metadata": {"coverage_kind": "price_daily"},
            },
        ],
    )


def test_pit_preprocessing_creates_queryable_f1_catalog_with_l1_blocker() -> None:
    client, _db_path = create_test_client(_runtime_dir("pit-f1-catalog"))
    _seed_price_snapshot_with_l1_gap(client)

    run = assert_ok(client.post("/admin/pit-preprocessing-runs", json={"as_of_date": "2024-01-02"}))
    assert run["status"] == "COMPLETED"
    assert run["catalog_snapshot_id"]
    assert run["summary"]["ic_ir_gate"] == "NOT_APPLIED"

    catalog = assert_ok(client.get("/factors/f1-catalog/latest"))
    assert catalog["snapshot"]["snapshot_id"] == run["catalog_snapshot_id"]
    assert catalog["summary"]["ic_ir_gate"] == "NOT_APPLIED"
    assert catalog["summary"]["admission_policy"] == "PIT_COVERAGE_TIMING_BLOCKER_ONLY"

    l1_fields = [field for field in catalog["items"] if field["pit_layer"] == "L1"]
    assert l1_fields
    assert all(field["admission_state"] == "DATA_SOURCE_BLOCKED" for field in l1_fields)
    assert all(field["blocker_code"] == "DATA_SOURCE_BLOCKED" for field in l1_fields)
    assert all("NaN" in field["missing_policy"] for field in l1_fields)
    assert all("MSFT" in field["missing_symbols"] for field in l1_fields)
    assert all("rank_ic" not in field["metadata"] for field in catalog["items"])


def test_f1_catalog_allows_l1_when_10y_window_is_fully_callable() -> None:
    client, _db_path = create_test_client(_runtime_dir("pit-f1-10y-ready"))
    _seed_price_snapshot_with_archival_gap_and_10y_ready(client)

    run = assert_ok(client.post("/admin/pit-preprocessing-runs", json={"as_of_date": "2026-05-19"}))
    assert run["status"] == "COMPLETED"

    catalog = assert_ok(client.get("/factors/f1-catalog/latest"))
    l1_fields = [field for field in catalog["items"] if field["pit_layer"] == "L1"]

    assert l1_fields
    assert all(field["admission_state"] == "READY_WITH_WARNING" for field in l1_fields)
    assert all(field["blocker_code"] is None for field in l1_fields)
    assert all(field["missing_symbol_count"] == 0 for field in l1_fields)
    assert all(field["coverage_ratio"] == 1.0 for field in l1_fields)
    assert all(field["metadata"]["coverage_context"]["active_window_missing_count"] == 0 for field in l1_fields)
    assert all(field["metadata"]["coverage_context"]["archival_missing_count"] == 1 for field in l1_fields)
    assert catalog["summary"]["callable_count"] >= len(l1_fields)
    assert catalog["summary"]["blocked_count"] == 0


def test_f1_catalog_filters_layer_status_and_query() -> None:
    client, _db_path = create_test_client(_runtime_dir("pit-f1-catalog-filter"))
    _seed_price_snapshot_with_l1_gap(client)
    assert_ok(client.post("/admin/pit-preprocessing-runs", json={"as_of_date": "2024-01-02"}))

    payload = assert_ok(client.get("/factors/f1-catalog?layer=L1&status=DATA_SOURCE_BLOCKED&q=close"))

    assert payload["items"]
    assert all(field["pit_layer"] == "L1" for field in payload["items"])
    assert all(field["admission_state"] == "DATA_SOURCE_BLOCKED" for field in payload["items"])
    assert any(field["factor_id"] == "f1_price_close" for field in payload["items"])

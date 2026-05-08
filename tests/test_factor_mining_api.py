from __future__ import annotations

import time
import threading
from datetime import date, timedelta
from pathlib import Path
from uuid import uuid4

from grit_backtest_platform.factor_mining import (
    FactorMiningCandidateSummary,
    FactorMiningRunner,
    FactorMiningJobCreateRequest,
    FactorMiningJobResult,
    create_synthetic_market_data,
    factor_ir_from_rank_ic,
    factor_mining_job_id_for_request,
    run_factor_mining_job,
)
from tests.api_test_support import assert_ok, create_test_client


ACTIVE_MINING_STATUSES = {"QUEUED", "RUNNING", "CANCEL_REQUESTED"}


def _request(*, candidate_count: int = 40, operators: tuple[str, ...] | None = None) -> FactorMiningJobCreateRequest:
    return FactorMiningJobCreateRequest(
        universe=("AAPL", "MSFT", "NVDA", "AMZN", "JPM", "XOM"),
        start_date="2018-01-01",
        end_date="2024-12-31",
        operators=operators
        or (
            "return",
            "momentum",
            "std",
            "log",
            "rank",
            "zscore",
            "winsorize",
            "arithmetic",
        ),
        candidate_count=candidate_count,
        random_seed=17,
        min_rank_ic=0.0,
        max_depth=3,
    )


def _business_days(start: date, count: int) -> list[date]:
    days: list[date] = []
    cursor = start
    while len(days) < count:
        if cursor.weekday() < 5:
            days.append(cursor)
        cursor += timedelta(days=1)
    return days


def _runtime_test_dir(name: str) -> Path:
    root = Path(__file__).resolve().parents[1] / ".tmp" / "pytest-runtime" / "factor-mining-api"
    path = root / f"{name}-{uuid4().hex}"
    path.mkdir(parents=True, exist_ok=False)
    return path


def wait_for_factor_mining_job(client, job_id: str, *, timeout_seconds: float = 30.0) -> dict:
    deadline = time.monotonic() + timeout_seconds
    last_payload: dict | None = None
    while time.monotonic() < deadline:
        last_payload = assert_ok(client.get(f"/factor-mining/jobs/{job_id}"))
        if last_payload["status"] not in ACTIVE_MINING_STATUSES:
            return last_payload
        time.sleep(0.05)
    raise AssertionError(f"factor mining job did not finish: {last_payload}")


def seed_factor_mining_price_snapshot(client, *, symbols: tuple[str, ...] = ("AAPL", "MSFT", "NVDA", "AMZN", "JPM", "XOM")) -> None:
    repository = client.app.state.service.market_data_repository
    days = _business_days(date(2018, 1, 2), 520)
    price_bars = []
    coverage = []
    for symbol_index, symbol in enumerate(symbols):
        price = 90.0 + symbol_index * 11.0
        drift = 0.0004 + symbol_index * 0.00008
        for day_index, current_day in enumerate(days):
            price = round(price * (1.0 + drift + (day_index % 5) * 0.00004), 4)
            price_bars.append(
                {
                    "symbol": symbol,
                    "date": current_day.isoformat(),
                    "open": price * 0.998,
                    "high": price * 1.003,
                    "low": price * 0.997,
                    "close": price,
                    "adj_close": price,
                    "volume": 1_000_000 + day_index * 100,
                    "source": "unit_test_runtime_price",
                    "fallback_source": "none",
                }
            )
        coverage.append(
            {
                "symbol": symbol,
                "start_date": days[0].isoformat(),
                "end_date": days[-1].isoformat(),
                "status": "READY",
                "row_count": len(days),
                "source": "unit_test_runtime_price",
                "fallback_source": "none",
                "metadata": {"coverage_kind": "price_daily"},
            }
        )
    repository.replace_dataset_snapshot(
        {
            "id": "ds-price",
            "name": "股票价格数据",
            "status": "READY",
            "as_of": days[-1].isoformat(),
            "freshness_label": "单元测试 PIT 快照",
            "start_date": days[0].isoformat(),
            "end_date": days[-1].isoformat(),
            "row_count": len(price_bars),
            "source": "unit_test_runtime_price",
            "fallback_source": "none",
            "metadata": {
                "covered_symbol_count": len(symbols),
                "total_symbol_count": len(symbols),
            },
        },
        price_bars=price_bars,
        symbol_coverage=coverage,
    )


def test_factor_mining_runner_completes_one_thousand_candidate_small_batch() -> None:
    request = _request(candidate_count=1000)

    result = run_factor_mining_job(request)

    assert result.status == "COMPLETED"
    assert result.requested_candidates == 1000
    assert result.candidates_evaluated == 1000
    assert result.progress_pct == 100.0
    assert result.throughput_per_second > 0
    assert result.failed_samples == ()
    assert result.top_candidates
    assert all(candidate.persisted_to_factor_definitions is False for candidate in result.all_candidates)


def test_factor_mining_result_has_api_ready_projection_shape() -> None:
    result = run_factor_mining_job(_request(candidate_count=12), top_k=3)

    payload = result.to_api_dict()

    assert payload["job_id"].startswith("fm_")
    assert payload["status"] == "COMPLETED"
    assert payload["requested_candidates"] == 12
    assert len(payload["top_candidates"]) == 3
    top_candidate = payload["top_candidates"][0]
    assert {
        "candidate_id",
        "rank",
        "expression",
        "rank_ic",
        "coverage",
        "status",
        "risk_flags",
        "persisted_to_factor_definitions",
    }.issubset(top_candidate)
    assert {
        "fitness_score",
        "max_style_correlation",
        "correlation_penalty",
        "max_drawdown_pct",
        "benchmark_max_drawdown_pct",
        "drawdown_vs_benchmark_ratio",
        "auto_residual_summary",
    }.issubset(top_candidate)


def test_factor_mining_fitness_penalizes_correlation_and_complexity() -> None:
    result = run_factor_mining_job(_request(candidate_count=16, operators=("return", "std", "log")), top_k=8)

    assert result.top_candidates
    assert all(candidate.fitness_score is not None for candidate in result.top_candidates)
    assert any((candidate.max_style_correlation or 0) > 0.3 for candidate in result.all_candidates)
    assert any(candidate.auto_residual_summary for candidate in result.all_candidates)
    for candidate in result.all_candidates:
        if (candidate.max_style_correlation or 0) > 0.3:
            assert candidate.correlation_penalty > 0


def test_factor_mining_uses_non_overlapping_forward_return_anchor() -> None:
    request = FactorMiningJobCreateRequest(
        universe=("A", "B", "C", "D"),
        start_date="2020-01-01",
        end_date="2020-12-31",
        operators=("return",),
        candidate_count=1,
        random_seed=1,
        min_rank_ic=0.0,
        max_depth=3,
    )
    runner = FactorMiningRunner(request)

    def close_series(day3: float, day6: float, day8: float, day11: float) -> list[float]:
        values = [100.0] * 12
        values[3] = day3
        values[6] = day6
        values[8] = day8
        values[11] = day11
        return values

    market_data = {
        "A": {"Close": close_series(100.0, 130.0, 100.0, 130.0)},
        "B": {"Close": close_series(100.0, 120.0, 100.0, 132.0)},
        "C": {"Close": close_series(100.0, 110.0, 100.0, 132.0)},
        "D": {"Close": close_series(100.0, 100.0, 100.0, 140.0)},
    }

    candidate = runner._evaluate_candidate(0, "Return(Close, 3)", market_data)

    assert candidate.rank_ic is not None
    assert candidate.rank_ic < -0.9


def test_factor_mining_newey_west_adjusts_long_horizon_ir() -> None:
    assert factor_ir_from_rank_ic(0.3697, 63) == 0.9316
    assert factor_ir_from_rank_ic(0.3697, 63) < 2.0


def test_factor_mining_reports_pure_residual_ic_against_short_momentum() -> None:
    request = _request(candidate_count=1, operators=("return",))
    market_data = create_synthetic_market_data(request.universe, length=160, seed=11)
    runner = FactorMiningRunner(request)

    candidate = runner._evaluate_candidate(0, "Return(Close, 63)", market_data)

    assert candidate.holding_period == 63
    assert candidate.pure_rank_ic is not None
    assert candidate.auto_residual_summary
    assert candidate.auto_residual_summary["control_factor_id"] == "Return(Close, 3)"
    assert candidate.auto_residual_summary["residual_rank_ic"] == round(candidate.pure_rank_ic, 6)


def test_factor_mining_top_candidates_are_expression_deduped() -> None:
    result = run_factor_mining_job(
        _request(candidate_count=40, operators=("return",)),
        top_k=10,
    )

    expressions = [candidate.expression for candidate in result.top_candidates]

    assert expressions
    assert len(expressions) == len(set(expressions))


def test_factor_mining_unknown_operator_is_contained_as_failed_sample() -> None:
    result = run_factor_mining_job(_request(candidate_count=5, operators=("return", "UnknownOp")))

    assert result.status == "PARTIALLY_FAILED"
    assert result.failed_samples
    assert result.failed_samples[0].expression == "unknownop(Close)"
    assert result.top_candidates
    assert all(candidate.persisted_to_factor_definitions is False for candidate in result.top_candidates)


def test_factor_mining_runner_can_cancel_synchronous_job() -> None:
    result = run_factor_mining_job(
        _request(candidate_count=100),
        should_cancel=lambda index: index >= 7,
    )

    assert result.status == "CANCELLED"
    assert result.candidates_evaluated == 7
    assert result.progress_pct < 100.0


def test_factor_mining_uses_provided_market_data_and_reports_low_coverage() -> None:
    request = _request(candidate_count=8)
    market_data = create_synthetic_market_data(request.universe[:3], length=320, seed=3)

    result = run_factor_mining_job(request, market_data=market_data)

    assert result.status == "COMPLETED"
    assert result.top_candidates
    assert all(candidate.coverage == 0.5 for candidate in result.all_candidates)


def test_factor_mining_rejects_invalid_job_request() -> None:
    request = FactorMiningJobCreateRequest(
        universe=(),
        start_date="2018-01-01",
        end_date="2024-12-31",
        operators=("return",),
        candidate_count=1,
        random_seed=1,
    )

    try:
        run_factor_mining_job(request)
    except ValueError as exc:
        assert "universe is required" in str(exc)
    else:
        raise AssertionError("expected invalid request to be rejected")


def test_factor_mining_api_runs_one_thousand_candidates_without_factor_library_write() -> None:
    client, _db_path = create_test_client(_runtime_test_dir("seeded-price"))
    seed_factor_mining_price_snapshot(client)
    storage = client.app.state.service.storage
    before = storage.fetch_one("SELECT COUNT(*) AS count FROM factor_definitions")["count"]

    submitted = assert_ok(
        client.post(
            "/factor-mining/jobs",
            json={
                "universe": "AAPL,MSFT,NVDA,AMZN,JPM,XOM",
                "start_date": "2018-01-01",
                "end_date": "2024-12-31",
                "operators": ["return", "momentum", "std", "log", "rank", "zscore", "winsorize", "arithmetic"],
                "candidate_count": 1000,
                "random_seed": 17,
                "min_rank_ic": 0.0,
                "max_depth": 3,
            },
        )
    )

    assert submitted["status"] == "RUNNING"
    assert submitted["progress"]["percent"] == 0.0
    created = wait_for_factor_mining_job(client, submitted["id"])

    assert created["status"] == "COMPLETED"
    assert created["progress"]["total_candidates"] == 1000
    assert created["progress"]["evaluated_candidates"] == 1000
    assert created["progress"]["throughput_per_second"] > 0
    assert created["top_candidates"]
    assert created["summary"]["persisted_to_factor_definitions"] is False
    assert created["summary"]["market_data_source"] == "dataset_price_bars"
    assert created["summary"]["synthetic_market_data"] is False
    assert created["summary"]["price_symbol_count"] == 6
    candidate_rows = storage.fetch_one(
        "SELECT COUNT(*) AS count FROM factor_mining_candidates WHERE job_id = ?",
        (created["id"],),
    )["count"]
    after = storage.fetch_one("SELECT COUNT(*) AS count FROM factor_definitions")["count"]
    assert candidate_rows > 0
    assert after == before

    listed = assert_ok(client.get("/factor-mining/jobs"))
    assert listed["items"][0]["id"] == created["id"]
    detail = assert_ok(client.get(f"/factor-mining/jobs/{created['id']}"))
    assert detail["id"] == created["id"]
    cancelled = assert_ok(client.post(f"/factor-mining/jobs/{created['id']}/cancel"))
    assert cancelled["id"] == created["id"]


def test_factor_mining_api_reports_running_progress_before_completion(monkeypatch) -> None:
    client, _db_path = create_test_client(_runtime_test_dir("running-progress"))
    seed_factor_mining_price_snapshot(client)

    progress_checkpoint_reached = threading.Event()
    release_job = threading.Event()

    import grit_backtest_platform._real_service_rebuilt as real_service_module

    def fake_run_factor_mining_job(request, market_data=None, *, should_cancel=None, top_k=10):
        assert should_cancel is not None
        should_cancel(0)
        should_cancel(20)
        progress_checkpoint_reached.set()
        assert release_job.wait(timeout=5)
        candidate = FactorMiningCandidateSummary(
            candidate_id=f"{factor_mining_job_id_for_request(request)}_cand_001",
            rank=1,
            expression="Return(Close, 5)",
            rank_ic=0.05,
            coverage=1.0,
            status="READY",
        )
        return FactorMiningJobResult(
            job_id=factor_mining_job_id_for_request(request),
            status="COMPLETED",
            requested_candidates=request.candidate_count,
            candidates_evaluated=request.candidate_count,
            progress_pct=100.0,
            throughput_per_second=25.0,
            top_candidates=(candidate,),
            all_candidates=(candidate,),
        )

    monkeypatch.setattr(real_service_module, "run_factor_mining_job", fake_run_factor_mining_job)

    submitted = assert_ok(
        client.post(
            "/factor-mining/jobs",
            json={
                "universe": "AAPL,MSFT,NVDA,AMZN,JPM,XOM",
                "start_date": "2018-01-01",
                "end_date": "2024-12-31",
                "operators": ["return", "rank"],
                "candidate_count": 100,
                "random_seed": 17,
                "min_rank_ic": 0.0,
                "max_depth": 3,
            },
        )
    )

    try:
        assert progress_checkpoint_reached.wait(timeout=5)
        running = assert_ok(client.get(f"/factor-mining/jobs/{submitted['id']}"))
        assert running["status"] == "RUNNING"
        assert running["progress"]["evaluated_candidates"] == 20
        assert running["progress"]["percent"] == 20.0
        assert running["progress"]["throughput_per_second"] > 0
    finally:
        release_job.set()

    completed = wait_for_factor_mining_job(client, submitted["id"])
    assert completed["status"] == "COMPLETED"
    assert completed["progress"]["percent"] == 100.0


def test_factor_mining_api_reuses_duplicate_request_without_recompute(monkeypatch) -> None:
    client, _db_path = create_test_client(_runtime_test_dir("duplicate-request"))
    seed_factor_mining_price_snapshot(client)
    payload = {
        "universe": "AAPL,MSFT,NVDA,AMZN,JPM,XOM",
        "start_date": "2018-01-01",
        "end_date": "2024-12-31",
        "operators": ["return", "rank", "zscore"],
        "candidate_count": 80,
        "random_seed": 29,
        "min_rank_ic": 0.0,
        "max_depth": 3,
    }
    submitted = assert_ok(client.post("/factor-mining/jobs", json=payload))
    created = wait_for_factor_mining_job(client, submitted["id"])

    import grit_backtest_platform._real_service_rebuilt as real_service_module

    def fail_if_recomputed(*_args, **_kwargs):
        raise AssertionError("duplicate factor-mining request should return the stored job")

    monkeypatch.setattr(real_service_module, "run_factor_mining_job", fail_if_recomputed)
    duplicate = assert_ok(client.post("/factor-mining/jobs", json=payload))

    assert duplicate["id"] == created["id"]
    assert duplicate["status"] == "COMPLETED"
    assert duplicate["updated_at"] == created["updated_at"]


def test_factor_mining_api_reuses_same_configuration_with_different_seed() -> None:
    client, _db_path = create_test_client(_runtime_test_dir("duplicate-visible-config"))
    seed_factor_mining_price_snapshot(client)
    payload = {
        "universe": "AAPL,MSFT,NVDA,AMZN,JPM,XOM",
        "start_date": "2018-01-01",
        "end_date": "2024-12-31",
        "operators": ["return", "rank", "zscore"],
        "candidate_count": 80,
        "random_seed": 29,
        "min_rank_ic": 0.0,
        "max_depth": 3,
    }
    submitted = assert_ok(client.post("/factor-mining/jobs", json=payload))
    created = wait_for_factor_mining_job(client, submitted["id"])

    duplicate = assert_ok(client.post("/factor-mining/jobs", json={**payload, "random_seed": 30}))
    listed = assert_ok(client.get("/factor-mining/jobs"))

    assert duplicate["id"] == created["id"]
    assert [item["id"] for item in listed["items"]].count(created["id"]) == 1
    assert listed["summary"]["total"] == 1


def test_factor_mining_api_rejects_without_runtime_price_snapshot() -> None:
    client, _db_path = create_test_client(_runtime_test_dir("missing-price"))

    response = client.post(
        "/factor-mining/jobs",
        json={
            "universe": "AAPL,MSFT,NVDA",
            "start_date": "2018-01-01",
            "end_date": "2024-12-31",
            "operators": ["return", "rank"],
            "candidate_count": 10,
            "random_seed": 17,
            "min_rank_ic": 0.0,
            "max_depth": 3,
        },
    )

    assert response.status_code == 400
    assert "synthetic" in response.json()["message"]

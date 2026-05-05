from __future__ import annotations

from grit_backtest_platform.factor_mining import (
    FactorMiningJobCreateRequest,
    create_synthetic_market_data,
    run_factor_mining_job,
)
from tests.api_test_support import assert_ok, create_test_client


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


def test_factor_mining_api_runs_one_thousand_candidates_without_factor_library_write(tmp_path) -> None:
    client, _db_path = create_test_client(tmp_path)
    storage = client.app.state.service.storage
    before = storage.fetch_one("SELECT COUNT(*) AS count FROM factor_definitions")["count"]

    created = assert_ok(
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

    assert created["status"] == "COMPLETED"
    assert created["progress"]["total_candidates"] == 1000
    assert created["progress"]["evaluated_candidates"] == 1000
    assert created["progress"]["throughput_per_second"] > 0
    assert created["top_candidates"]
    assert created["summary"]["persisted_to_factor_definitions"] is False
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

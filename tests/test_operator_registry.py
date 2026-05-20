from __future__ import annotations

import sqlite3
import math

import pytest

from grit_backtest_platform.factor_expression_engine import evaluate_expression
from grit_backtest_platform._storage_restored import SQLiteStorage, dumps, loads
from grit_backtest_platform.models import CompositionMethodConfig
from grit_backtest_platform.operator_registry import (
    DEFAULT_COMPOSITION_PUBLISH_BOUNDARY,
    DEFAULT_ENABLED_OPERATORS,
    DEFAULT_GOVERNANCE_PROTOCOL,
    DEFAULT_OPERATOR_DEPTH,
    DEFAULT_OPERATOR_WINDOW_SPACE,
    default_operator_config,
    normalize_composition_methods,
    normalize_operator_config,
    operator_definitions,
)


def test_operator_registry_registers_core_phase0_defaults() -> None:
    definitions = operator_definitions()
    operator_ids = {item.operator_id for item in definitions}

    assert len(definitions) >= 25
    assert set(DEFAULT_ENABLED_OPERATORS) == {"TS_Return", "TS_Rank", "TS_Corr"}
    assert {"TS_Return", "TS_Rank", "TS_Corr", "Reg_Resid", "Signed_Power", "Sum_Out_Of"} <= operator_ids

    draft = default_operator_config()
    assert draft["enabled_operators"] == list(DEFAULT_ENABLED_OPERATORS)
    assert draft["window_space"] == list(DEFAULT_OPERATOR_WINDOW_SPACE)
    assert draft["default_depth"] == DEFAULT_OPERATOR_DEPTH
    assert draft["daily_formula_budget"] == 10000
    assert draft["compute_backend"] == "pandas_bottleneck"
    assert "DATA_SOURCE_BLOCKED" in draft["blocked_field_policy"]
    assert "NaN" in draft["min_periods_policy"]
    assert draft["governance_protocol"] == DEFAULT_GOVERNANCE_PROTOCOL
    assert draft["governance_protocol"]["wnzt_standard_flow"] is True
    assert draft["governance_protocol"]["orthogonalization_enabled"] is False
    assert draft["governance_protocol"]["turnover_filter_enabled"] is False
    assert [method["id"] for method in draft["composition_methods"]] == [
        "linear_weighting",
        "ratio_risk_adjusted",
        "residual_orthogonal",
        "rank_pooling",
        "ffblend_style",
        "divergence_penalty",
        "ts_denoise",
    ]
    assert {method["publish_boundary"] for method in draft["composition_methods"]} == {
        DEFAULT_COMPOSITION_PUBLISH_BOUNDARY,
    }
    assert all(isinstance(method["enabled"], bool) for method in draft["composition_methods"])
    ratio = next(method for method in draft["composition_methods"] if method["method_type"] == "RATIO_RISK_ADJUSTED")
    assert ratio["params"]["denominator_floor"] == pytest.approx(0.05)


def test_operator_config_validation_rejects_unknown_operator_and_window() -> None:
    with pytest.raises(ValueError):
        normalize_operator_config({"enabled_operators": ["TS_Return", "Unknown_Operator"]})

    with pytest.raises(ValueError):
        normalize_operator_config({"window_space": [3, 0, 21]})

    with pytest.raises(ValueError):
        normalize_operator_config({"daily_formula_budget": 10001})

    normalized = normalize_operator_config(
        {
            "governance_protocol": {
                "orthogonalization_enabled": True,
                "turnover_filter_enabled": True,
            }
        }
    )
    assert normalized["governance_protocol"]["orthogonalization_enabled"] is True
    assert normalized["governance_protocol"]["turnover_filter_enabled"] is True
    assert normalized["governance_protocol"]["wnzt_standard_flow"] is True


def test_composition_method_normalization_validates_boundaries() -> None:
    defaults = default_operator_config()["composition_methods"]
    ratio = next(method for method in defaults if method["id"] == "ratio_risk_adjusted")

    normalized = normalize_composition_methods([
        {**ratio, "enabled": False, "params": {"floor": 0.07, "rank_space": True}},
    ])
    normalized_ratio = next(method for method in normalized if method["id"] == "ratio_risk_adjusted")
    assert normalized_ratio["enabled"] is False
    assert normalized_ratio["params"]["denominator_floor"] == pytest.approx(0.07)
    assert len(normalized) == 7

    with pytest.raises(ValueError, match="publish_boundary"):
        normalize_composition_methods([{**ratio, "publish_boundary": "manual_after_quarantine"}])

    with pytest.raises(ValueError, match="denominator_floor"):
        normalize_composition_methods([{**ratio, "params": {"denominator_floor": 0}}])

    with pytest.raises(ValueError, match="enabled"):
        normalize_composition_methods([{**ratio, "enabled": "true"}])


def test_composition_method_pydantic_contract_rejects_invalid_boundary_floor_and_enabled() -> None:
    CompositionMethodConfig(
        id="ratio_risk_adjusted",
        label="比例/风险调整合成",
        theme="风险调节",
        method_type="RATIO_RISK_ADJUSTED",
        enabled=True,
        formula_template="F3 = Rank(F2_alpha) / max(Rank(F2_risk), denominator_floor)",
        params={"denominator_floor": 0.05},
    )

    with pytest.raises(ValueError):
        CompositionMethodConfig(
            id="ratio_risk_adjusted",
            label="比例/风险调整合成",
            theme="风险调节",
            method_type="RATIO_RISK_ADJUSTED",
            enabled=True,
            formula_template="F3 = Rank(F2_alpha) / max(Rank(F2_risk), denominator_floor)",
            params={},
        )

    with pytest.raises(ValueError):
        CompositionMethodConfig(
            id="linear_weighting",
            label="线性加权合成",
            theme="风格复合",
            method_type="LINEAR_WEIGHTING",
            enabled="true",
            formula_template="F3 = sum(w_i * ZScore(F2_i))",
            publish_boundary="D2_QUARANTINE_ONLY",
        )

    with pytest.raises(ValueError):
        CompositionMethodConfig(
            id="linear_weighting",
            label="线性加权合成",
            theme="风格复合",
            method_type="LINEAR_WEIGHTING",
            enabled=True,
            formula_template="F3 = sum(w_i * ZScore(F2_i))",
            publish_boundary="manual_after_quarantine",
        )


def test_operator_registry_storage_backfills_legacy_composition_methods(tmp_path) -> None:
    db_path = tmp_path / "legacy-operator-registry.sqlite3"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE operator_registry_snapshots (
                id TEXT PRIMARY KEY,
                snapshot_id TEXT NOT NULL UNIQUE,
                generated_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'ACTIVE',
                default_depth INTEGER NOT NULL DEFAULT 2,
                daily_formula_budget INTEGER NOT NULL DEFAULT 10000,
                compute_backend TEXT NOT NULL DEFAULT 'pandas_bottleneck',
                window_space_json TEXT NOT NULL DEFAULT '[]',
                enabled_operators_json TEXT NOT NULL DEFAULT '[]',
                operator_count INTEGER NOT NULL DEFAULT 0,
                min_periods_policy TEXT NOT NULL DEFAULT '',
                blocked_field_policy TEXT NOT NULL DEFAULT '',
                governance_protocol_json TEXT NOT NULL DEFAULT '{}',
                created_by TEXT NOT NULL DEFAULT 'operator',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            INSERT INTO operator_registry_snapshots (
                id, snapshot_id, generated_at, status, default_depth, daily_formula_budget,
                compute_backend, window_space_json, enabled_operators_json, operator_count,
                min_periods_policy, blocked_field_policy, governance_protocol_json,
                created_by, notes, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "legacy",
                "legacy",
                "2026-05-20T00:00:00Z",
                "ACTIVE",
                2,
                10000,
                "pandas_bottleneck",
                dumps([3, 21]),
                dumps(["TS_Return"]),
                1,
                "min_periods",
                "blocked",
                dumps({}),
                "operator",
                "",
                "2026-05-20T00:00:00Z",
            ),
        )
    storage = SQLiteStorage(db_path)

    legacy = storage.fetch_one("SELECT composition_methods_json FROM operator_registry_snapshots WHERE snapshot_id = ?", ("legacy",))
    assert legacy is not None
    methods = loads(legacy["composition_methods_json"], [])
    assert len(methods) == 7
    assert methods[1]["method_type"] == "RATIO_RISK_ADJUSTED"

    storage.insert_json_row(
        "operator_registry_snapshots",
        {
            "id": "new-snapshot",
            "snapshot_id": "new-snapshot",
            "generated_at": "2026-05-20T00:01:00Z",
            "status": "ACTIVE",
            "default_depth": 2,
            "daily_formula_budget": 10000,
            "compute_backend": "pandas_bottleneck",
            "window_space_json": dumps([3, 21]),
            "enabled_operators_json": dumps(["TS_Return"]),
            "operator_count": 1,
            "min_periods_policy": "min_periods",
            "blocked_field_policy": "blocked",
            "governance_protocol_json": dumps({}),
            "created_by": "operator",
            "notes": "",
            "created_at": "2026-05-20T00:01:00Z",
        },
    )
    inserted = storage.fetch_one("SELECT composition_methods_json FROM operator_registry_snapshots WHERE snapshot_id = ?", ("new-snapshot",))
    assert inserted is not None
    assert len(loads(inserted["composition_methods_json"], [])) == 7


def test_phase0_expression_aliases_preserve_nan_for_insufficient_history() -> None:
    data = {
        "Close": [10.0, 20.0, 30.0, 40.0],
        "Volume": [10.0, 20.0, 30.0, 40.0],
    }

    ts_return = evaluate_expression("TS_Return(Close, 2)", data)
    assert ts_return[:2] == [None, None]
    assert ts_return[-1] == pytest.approx(1.0)

    ts_rank = evaluate_expression("TS_Rank(Close, 3)", data)
    assert ts_rank[:2] == [None, None]
    assert ts_rank[-1] is not None

    corr = evaluate_expression("TS_Corr(Close, Volume, 3)", data)
    assert corr[:2] == [None, None]
    assert corr[-1] == pytest.approx(1.0)

    log_values = evaluate_expression("Log(Close - 20)", data)
    assert log_values[0] is None
    assert math.isfinite(log_values[-1])

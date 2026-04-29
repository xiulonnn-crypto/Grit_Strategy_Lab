import { describe, expect, it } from "vitest";
import type { ApiBacktestRunListItem } from "./types";
import {
  buildSmartEvidenceTasks,
  buildStrategyEvidenceGroups,
  formatMetricValue,
  inferEvidencePeriod,
} from "./lib/runs-strategy-library-view-model";

function run(
  overrides: Partial<ApiBacktestRunListItem> & {
    id: string;
    strategy_id?: string;
  },
): ApiBacktestRunListItem {
  return {
    strategy_id: "strat-a",
    status: "COMPLETED",
    start_date: "2016-01-01",
    end_date: "2025-12-31",
    completed_at: "2026-01-01T00:00:00Z",
    parameter_version_id: "strat-a-v1",
    is_permanent: true,
    metrics: { total_return: 24.5, sharpe: 1.2, max_drawdown: -8.4 },
    ...overrides,
  };
}

describe("runs strategy library view model", () => {
  it("infers evidence periods from direct dates and preview fallback dates", () => {
    expect(
      inferEvidencePeriod({
        start_date: "2016-01-01",
        end_date: "2025-12-31",
      }),
    ).toBe("10Y");
    expect(
      inferEvidencePeriod({
        start_date: "2006-01-01",
        end_date: "2025-12-31",
      }),
    ).toBe("20Y");
    expect(
      inferEvidencePeriod({
        start_date: null,
        end_date: null,
        preview: {
          effective_start_date: "1996-01-01",
          effective_end_date: "2025-12-31",
        },
      }),
    ).toBe("30Y");
    expect(
      inferEvidencePeriod({
        start_date: "2022-01-01",
        end_date: "2025-12-31",
      }),
    ).toBe("CUSTOM");
  });

  it("groups the same strategy into multiple parameter-version evidence nodes", () => {
    const groups = buildStrategyEvidenceGroups(
      [
        run({ id: "run-v1-10y", parameter_version_id: "strat-a-v1" }),
        run({
          id: "run-v1-20y",
          parameter_version_id: "strat-a-v1",
          start_date: "2006-01-01",
        }),
        run({
          id: "run-v2-10y",
          parameter_version_id: "strat-a-v2",
          completed_at: "2026-02-01T00:00:00Z",
        }),
      ],
      [{
        id: "strat-a",
        name: "Quality Momentum",
        strategy_type: "MOMENTUM",
        universe_name: "SP500",
        parameter_history: [],
      }],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].strategyName).toBe("Quality Momentum");
    expect(groups[0].versions.map((version) => version.id)).toEqual([
      "strat-a-v2",
      "strat-a-v1",
    ]);
    expect(groups[0].versions.find((version) => version.id === "strat-a-v1")?.periods).toEqual([
      "10Y",
      "20Y",
    ]);
  });

  it("keeps temporary runs in deep detail while excluding them from flat evidence periods", () => {
    const groups = buildStrategyEvidenceGroups([
      run({ id: "run-10y" }),
      run({
        id: "run-temp-20y",
        start_date: "2006-01-01",
        is_permanent: false,
      }),
    ]);
    const version = groups[0].versions[0];

    expect(version.runs.map((item) => item.id)).toContain("run-temp-20y");
    expect(version.persistentRuns.map((item) => item.id)).not.toContain("run-temp-20y");
    expect(version.hasTemporaryRuns).toBe(true);
    expect(version.periods).toEqual(["10Y"]);
    expect(version.missingPeriods).toEqual(["20Y", "30Y"]);
    expect(version.runs.find((item) => item.id === "run-temp-20y")?.isTemporary).toBe(true);
  });

  it("classifies mature, drift, broken, and failed-review evidence states", () => {
    const groups = buildStrategyEvidenceGroups([
      run({ id: "mature-10y", strategy_id: "mature", parameter_version_id: "mature-v1" }),
      run({
        id: "mature-20y",
        strategy_id: "mature",
        parameter_version_id: "mature-v1",
        start_date: "2006-01-01",
      }),
      run({
        id: "mature-30y",
        strategy_id: "mature",
        parameter_version_id: "mature-v1",
        start_date: "1996-01-01",
      }),
      run({
        id: "drift-10y",
        strategy_id: "drift",
        parameter_version_id: "drift-v1",
        metrics: { total_return: 0.1, sharpe: 1.8, max_drawdown: -0.04 },
      }),
      run({
        id: "drift-20y",
        strategy_id: "drift",
        parameter_version_id: "drift-v1",
        start_date: "2006-01-01",
        metrics: { total_return: 0.08, sharpe: 1.1, max_drawdown: -0.06 },
      }),
      run({
        id: "drift-30y",
        strategy_id: "drift",
        parameter_version_id: "drift-v1",
        start_date: "1996-01-01",
        metrics: { total_return: 0.09, sharpe: 1.2, max_drawdown: -0.07 },
      }),
      run({
        id: "broken-custom",
        strategy_id: "broken",
        parameter_version_id: "broken-v1",
        start_date: "2022-01-01",
      }),
      run({
        id: "failed-run",
        strategy_id: "failed",
        parameter_version_id: "failed-v1",
        status: "FAILED",
      }),
    ]);
    const byId = new Map(groups.map((group) => [group.strategyId, group]));

    expect(byId.get("mature")?.versions[0].status).toBe("MATURE");
    expect(byId.get("drift")?.versions[0].status).toBe("DRIFT");
    expect(byId.get("broken")?.versions[0].status).toBe("BROKEN");
    expect(byId.get("failed")?.versions[0].status).toBe("FAILED_REVIEW");
  });

  it("generates smart tasks for missing 20Y and 30Y periods", () => {
    const groups = buildStrategyEvidenceGroups(
      [run({ id: "source-10y", strategy_id: "strat-task", parameter_version_id: "strat-task-v1" })],
      [{
        id: "strat-task",
        name: "Task Strategy",
        strategy_type: "GRID",
        universe_name: "NASDAQ100",
        parameter_history: [],
      }],
    );
    const tasks = buildSmartEvidenceTasks(groups);

    expect(tasks).toEqual([
      expect.objectContaining({
        id: "strat-task:strat-task-v1:20Y",
        strategyId: "strat-task",
        strategyName: "Task Strategy",
        versionId: "strat-task-v1",
        missingPeriods: ["20Y", "30Y"],
        sourceRunId: "source-10y",
        targetPeriod: "20Y",
        title: "证据断裂 Task Strategy v1",
        periodLabel: "20Y",
      }),
      expect.objectContaining({
        id: "strat-task:strat-task-v1:30Y",
        strategyId: "strat-task",
        strategyName: "Task Strategy",
        versionId: "strat-task-v1",
        missingPeriods: ["20Y", "30Y"],
        sourceRunId: "source-10y",
        targetPeriod: "30Y",
        title: "证据断裂 Task Strategy v1",
        periodLabel: "30Y",
      }),
    ]);
  });

  it("formats metric values with percent and signed options", () => {
    expect(formatMetricValue(0.1234, { percent: true })).toBe("12.3%");
    expect(formatMetricValue(1.234, { signed: true })).toBe("+1.23");
    expect(formatMetricValue(null)).toBe("--");
  });
});

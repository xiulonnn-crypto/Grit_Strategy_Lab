import { describe, expect, it } from "vitest";
import { collectOptimizationParameterSeeds } from "./lib/optimization-config-fields";
import type { ApiStrategyDetail } from "./types";

describe("collectOptimizationParameterSeeds", () => {
  it("expands asset allocation weights from allocation_assets", () => {
    const strategy: ApiStrategyDetail = {
      id: "strat-alloc-001",
      name: "Global Allocation",
      strategy_type: "ASSET_ALLOCATION",
      universe_name: "Global Allocation",
      rebalance_frequency: "quarterly",
      benchmark_symbol: "SPY",
      parameter_history: [],
      parameters: {
        allocation_assets: [
          { symbol: "SPY", display_name: "S&P 500 ETF", asset_class: "Equity" },
          { symbol: "TLT", display_name: "20Y Treasury ETF", asset_class: "Treasury" },
        ],
        allocation_weight__SPY_pct: 60,
        allocation_weight__TLT_pct: 40,
        rebalance_frequency: "quarterly",
        fee_bps: 1.5,
      },
    };

    const seeds = collectOptimizationParameterSeeds(strategy);

    expect(seeds.map((seed) => seed.key)).toEqual([
      "allocation_weight__SPY_pct",
      "allocation_weight__TLT_pct",
      "rebalance_frequency",
      "fee_bps",
    ]);
    expect(seeds.find((seed) => seed.key === "allocation_weight__SPY_pct")?.value).toBe(60);
    expect(seeds.find((seed) => seed.key === "rebalance_frequency")?.options?.map((option) => option.value)).toEqual([
      "monthly",
      "quarterly",
      "semiannual",
      "yearly",
    ]);
  });
});

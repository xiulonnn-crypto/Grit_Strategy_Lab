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

  it("expands multi-factor weights and governance knobs without raw objects", () => {
    const strategy: ApiStrategyDetail = {
      id: "strat-mf-001",
      name: "Multi Factor",
      strategy_type: "MULTI_FACTOR",
      universe_name: "SP500",
      rebalance_frequency: "monthly",
      benchmark_symbol: "SPY",
      parameter_history: [],
      parameters: {
        strategy_type: "MULTI_FACTOR",
        factor_ids: ["s_mom_12m1m_rank", "s_val_ep_ltm_raw"],
        weights: {
          s_mom_12m1m_rank: 0.6,
          s_val_ep_ltm_raw: 0.4,
        },
        neutralization: { enabled: false, method: "industry" },
        scoring_method: "zscore_weighted",
        rebalance_frequency: "monthly",
      },
      multi_factor_profile: {
        components: [
          {
            factor_id: "s_mom_12m1m_rank",
            name: "s_mom_12m1m_rank",
            weight: 0.6,
            normalized_weight: 0.6,
          },
          {
            factor_id: "s_val_ep_ltm_raw",
            name: "s_val_ep_ltm_raw",
            weight: 0.4,
            normalized_weight: 0.4,
          },
        ],
        neutralization: {
          enabled: false,
          method: "industry",
          execution_status: "DISABLED",
        },
        scoring_method: "zscore_weighted",
        rebalance_frequency: "monthly",
      },
    };

    const seeds = collectOptimizationParameterSeeds(strategy);

    expect(seeds.map((seed) => seed.key)).toEqual([
      "factor_weight__s_mom_12m1m_rank_pct",
      "factor_weight__s_val_ep_ltm_raw_pct",
      "scoring_method",
      "rebalance_frequency",
      "neutralization_method",
    ]);
    expect(seeds.find((seed) => seed.key === "factor_weight__s_mom_12m1m_rank_pct")?.label).toBe("因子权重 · 12-1月截面动量排名");
    expect(seeds.find((seed) => seed.key === "factor_weight__s_val_ep_ltm_raw_pct")?.label).toBe("因子权重 · 滚动市盈率倒数 (LTM)");
    expect(seeds.find((seed) => seed.key === "factor_weight__s_mom_12m1m_rank_pct")?.value).toBe(60);
    expect(seeds.find((seed) => seed.key === "neutralization_enabled")).toBeUndefined();
    expect(seeds.find((seed) => seed.key === "neutralization_method")?.value).toBe("industry");
    expect(seeds.find((seed) => seed.key === "scoring_method")?.options?.map((option) => option.value)).toContain("zscore_weighted");
  });

  it("keeps multi-factor percent weights from live strategy parameters", () => {
    const strategy: ApiStrategyDetail = {
      id: "strat-mf-002",
      name: "Multi Factor Percent",
      strategy_type: "MULTI_FACTOR",
      universe_name: "SP500",
      rebalance_frequency: "monthly",
      benchmark_symbol: "SPY",
      parameter_history: [],
      parameters: {
        strategy_type: "MULTI_FACTOR",
        factor_ids: ["s_mom_12m1m_rank", "s_val_ep_ltm_raw"],
        weights: {
          s_mom_12m1m_rank: 60,
          s_val_ep_ltm_raw: 40,
        },
        neutralization: { enabled: false, method: "industry" },
        scoring_method: "zscore_weighted",
        rebalance_frequency: "monthly",
      },
      multi_factor_profile: {
        components: [
          {
            factor_id: "s_mom_12m1m_rank",
            name: "12-1 动量",
            weight: 60,
            normalized_weight: 0.6,
          },
          {
            factor_id: "s_val_ep_ltm_raw",
            name: "EP 估值",
            weight: 40,
            normalized_weight: 0.4,
          },
        ],
        neutralization: {
          enabled: false,
          method: "industry",
          execution_status: "DISABLED",
        },
        scoring_method: "zscore_weighted",
        rebalance_frequency: "monthly",
      },
    };

    const seeds = collectOptimizationParameterSeeds(strategy);

    expect(seeds.find((seed) => seed.key === "factor_weight__s_mom_12m1m_rank_pct")?.value).toBe(60);
    expect(seeds.find((seed) => seed.key === "factor_weight__s_val_ep_ltm_raw_pct")?.value).toBe(40);
  });
});

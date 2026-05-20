import { describe, expect, it } from "vitest";
import { formatRunDetailKvValue } from "./lib/run-detail-kv-format";

describe("formatRunDetailKvValue", () => {
  it("formats multi-factor weights whether stored as decimals or percents", () => {
    expect(formatRunDetailKvValue("weights", {
      s_mom_12m1m_rank: 0.6,
      s_val_ep_ltm_raw: 0.4,
    })).toBe("Rank-12-1月截面动量 (排序) 60%；盈利收益率 (LTM) (原始) 40%");

    expect(formatRunDetailKvValue("weights", {
      s_mom_12m1m_rank: 60,
      s_val_ep_ltm_raw: 40,
    })).toBe("Rank-12-1月截面动量 (排序) 60%；盈利收益率 (LTM) (原始) 40%");
  });
});

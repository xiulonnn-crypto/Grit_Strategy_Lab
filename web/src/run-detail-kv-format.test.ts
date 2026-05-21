import { describe, expect, it } from "vitest";
import { formatRunDetailKvValue } from "./lib/run-detail-kv-format";

describe("formatRunDetailKvValue", () => {
  it("formats multi-factor weights whether stored as decimals or percents", () => {
    expect(formatRunDetailKvValue("weights", {
      s_mom_12m1m_rank: 0.6,
      s_val_ep_ltm_raw: 0.4,
    })).toBe("截面动量排名 (12-1m) [Rank] 60%；盈利收益率 (LTM) [Raw] 40%");

    expect(formatRunDetailKvValue("weights", {
      s_mom_12m1m_rank: 60,
      s_val_ep_ltm_raw: 40,
    })).toBe("截面动量排名 (12-1m) [Rank] 60%；盈利收益率 (LTM) [Raw] 40%");

    expect(formatRunDetailKvValue("weights", {
      a_mom_winsor3ret_3d_raw: 50,
      a_mom_ret_3d_raw: 50,
    })).toBe("平滑收益率 (3d) [Raw] 50%；收益率 (3d) [Raw] 50%");
  });
});

const CANONICAL_FACTOR_ALIASES: Record<string, string> = {
  momentum_12m_1m: 's_mom_12m1m_rank',
  value_ep_ltm: 's_val_ep_ltm_raw',
  value_bp_latest: 's_val_bp_latest_raw',
  lowvol_realized_252d: 's_vol_252d_rank',
  size_log_market_cap: 's_size_cur_log',
  quality_roe_ltm: 's_qlty_roe_ltm_raw',
  quality_fcf_yield: 's_qlty_fcfy_ttm_raw',
};

const CANONICAL_FACTOR_DISPLAY_NAMES: Record<string, string> = {
  s_mom_12m1m_rank: '12-1月截面动量排名',
  s_val_ep_ltm_raw: '滚动市盈率倒数 (LTM)',
  s_val_bp_latest_raw: '最新账面市值比',
  s_qlty_roe_ltm_raw: '滚动净资产收益率 (LTM)',
  s_qlty_fcfy_ttm_raw: '自由现金流收益率 (TTM)',
  s_vol_252d_rank: '252日实现波动率排名',
  s_size_cur_log: '市值规模对数',
};

function normalizeFactorId(factorId: unknown): string {
  return String(factorId ?? '').trim();
}

function canonicalFactorId(factorId: unknown): string {
  const normalized = normalizeFactorId(factorId);
  return CANONICAL_FACTOR_ALIASES[normalized] ?? normalized;
}

function isRawFactorId(value: string): boolean {
  const normalized = value.trim();
  return Boolean(
    normalized &&
      (CANONICAL_FACTOR_DISPLAY_NAMES[canonicalFactorId(normalized)] ||
        /^[a-z]_[a-z0-9]+(?:_[a-z0-9]+){2,}$/i.test(normalized) ||
        /^[a-z]+_[a-z0-9]+(?:_[a-z0-9]+)+$/i.test(normalized)),
  );
}

export function formatFactorDisplayName(
  factorId: unknown,
  fallbackName?: string | null,
): string {
  const normalizedFactorId = normalizeFactorId(factorId);
  const canonical = canonicalFactorId(normalizedFactorId);
  const canonicalName = CANONICAL_FACTOR_DISPLAY_NAMES[canonical];
  if (canonicalName) {
    return canonicalName;
  }

  const fallback = String(fallbackName ?? '').trim();
  if (fallback && !isRawFactorId(fallback)) {
    return fallback;
  }

  return normalizedFactorId || fallback || '未命名因子';
}

export function factorIdFromWeightKey(key: string): string | null {
  return key.match(/^factor_weight__(.+)_pct$/)?.[1]?.trim() || null;
}

export function formatFactorWeightLabel(key: string, fallbackName?: string | null): string | null {
  const factorId = factorIdFromWeightKey(key);
  if (!factorId) {
    return null;
  }
  return `因子权重 · ${formatFactorDisplayName(factorId, fallbackName)}`;
}

export function formatFactorList(factorIds: unknown[]): string {
  const rendered = factorIds
    .map((factorId) => formatFactorDisplayName(factorId))
    .filter((item) => item.trim().length > 0);
  return rendered.length ? rendered.join(' / ') : '未配置因子';
}

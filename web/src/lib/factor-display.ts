export const FACTOR_DISPLAY_NAME_SCHEMA_VERSION = 'factor_display_name_v4';
export const FACTOR_DISPLAY_NAME_PROTOCOL_VERSION = 'factor_display_name_v4_structured';
export const FACTOR_DISPLAY_NAME_STANDARD_VERSION = 'gsl_cn_naming_standard_2026_05';
export const FACTOR_DISPLAY_NAME_DEDUPE_STRATEGY = 'parameter_first_then_sha8';

const CANONICAL_FACTOR_ALIASES: Record<string, string> = {
  momentum_12m_1m: 's_mom_12m1m_rank',
  value_ep_ltm: 's_val_ep_ltm_raw',
  value_bp_latest: 's_val_bp_latest_raw',
  lowvol_realized_252d: 's_vol_252d_rank',
  size_log_market_cap: 's_size_cur_log',
  quality_roe_ltm: 's_qlty_roe_ltm_raw',
  quality_fcf_yield: 's_qlty_fcfy_ttm_raw',
  m_alpha_overnight_21d_raw: 's_f2_mom_ovn_mean_21d',
  s_alpha_ffblend_cur_rank: 's_alpha_ffblend_resid_mkt_rank',
};

const CANONICAL_FACTOR_DISPLAY_NAMES: Record<string, string> = {
  a_alpha_custom_cur_raw: '自定义 Alpha 信号 (当前) [Raw]',
  a_mom_ret_3d_raw: '收益率 (3d) [Raw]',
  a_mom_ret_126d_z: '收益率 (126d) [Refined]',
  a_mom_winsor3ret_3d_raw: '平滑收益率 (3d) [Raw]',
  f1_price_close: '交易所 - 前复权收盘价 (原始)',
  f1_price_adjclose: '交易所 - 前复权收盘价 (原始)',
  f1_return_1d_base: '交易所 - 1d 收益率基准 (原始)',
  f1_short_balance: 'FINRA - 空头余额 (原始)',
  f1_short_vol: 'FINRA - 当日卖空成交量 (原始)',
  s_price_adjclose_cur_raw: '交易所 - 前复权收盘价 (原始)',
  s_size_mcap_cur_raw: '交易所 - 总市值 (原始)',
  s_f2_mom_ovn_mean_21d: '隔夜动量均值 (21d) [Raw]',
  s_mom_12m1m_rank: '截面动量排名 (12-1m) [Rank]',
  s_mom_6m_rank: '截面动量排名 (126d) [Rank]',
  s_val_ep_ltm_raw: '盈利收益率 (LTM) [Raw]',
  s_val_bp_latest_raw: '账面市值比 (最新) [Raw]',
  s_val_cfp_ltm_raw: '现金流收益率 (LTM) [Raw]',
  s_val_evocf_ltm_raw: '经营现金流企业价值比 (LTM) [Raw]',
  s_qlty_roe_ltm_raw: '净资产收益率 (LTM) [Raw]',
  s_qlty_fcfy_ttm_raw: '自由现金流收益率 (LTM) [Raw]',
  s_qlty_leverage_cur_raw: '杠杆率 (当前) [Raw]',
  s_inv_assetgrowth_1y_rank: '资产增长率排名 (252d) [Rank]',
  s_inv_capex_ltm_raw: '资本开支率 (LTM) [Raw]',
  s_vol_252d_rank: '波动率排名 (252d) [Rank]',
  s_vol_downside_252d_rank: '下行波动率排名 (252d) [Rank]',
  s_liq_turnover_20d_rank: '换手率排名 (20d) [Rank]',
  s_liq_amihud_20d_rank: '非流动性排名 (20d) [Rank]',
  s_beta_market_252d_raw: '市场 Beta (252d) [Raw]',
  s_size_cur_log: '对数市值 (当前) [Raw]',
  s_alpha_ffblend_resid_mkt_rank: '[综合] - FF3 风格复合基石 (等权) [Beta-Free]',
  s_alpha_valvol_blend_resid_std_rk: '[估值] - 下行风险调节-现金流回报比 (LTM/252d) [Refined-Rank]',
  s_alpha_vol_downsiderev_std_rk: '[风险] - 反向下行风险 Alpha (252d) [Refined-Rank]',
};

export type FactorDisplayNameLookup = Record<string, string | null | undefined>;

const FACTOR_TOKEN_LABELS: Record<string, string> = {
  alpha: 'Alpha',
  amihud: '非流动性',
  assetgrowth: '资产增长',
  beta: 'Beta',
  bp: '账面市值比',
  capex: '资本开支',
  cfp: '现金流收益率',
  close: '收盘价',
  cur: '当前',
  downside: '下行',
  ep: '盈利收益率',
  f1: 'F1',
  f2: 'F2',
  fcfy: '自由现金流收益率',
  ffblend: '多因子融合',
  inv: '投资',
  latest: '最新',
  liq: '流动性',
  log: '对数',
  ltm: 'LTM',
  market: '市场',
  mcap: '总市值',
  mom: '动量',
  mean: '均值',
  ovn: '隔夜',
  price: '价格',
  qlty: '质量',
  rank: '排序',
  raw: '原始',
  ret: '收益率',
  roe: '净资产收益率',
  size: '规模',
  turnover: '换手率',
  ttm: 'LTM',
  val: '价值',
  valvol: '价值波动',
  vol: '波动率',
  z: 'ZScore',
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

function fallbackForFactorId(factorId: unknown, lookup?: FactorDisplayNameLookup): string | null {
  if (!lookup) return null;
  const normalized = normalizeFactorId(factorId);
  const canonical = canonicalFactorId(normalized);
  return lookup[normalized] ?? lookup[canonical] ?? null;
}

function formatWindowToken(token: string): string | null {
  const match = token.match(/^(\d+)(d|m|y)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (unit === 'm' && value === 1) return '21d';
  if (unit === 'm' && value === 3) return '63d';
  if (unit === 'm' && value === 6) return '126d';
  if (unit === 'y' && value === 1) return '252d';
  return `${value}${unit}`;
}

function describeRawFactorId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!isRawFactorId(normalized)) return null;
  const tokens = normalized.split('_').filter(Boolean);
  const labels = tokens
    .map((token) => formatWindowToken(token) ?? FACTOR_TOKEN_LABELS[token] ?? null)
    .filter((label): label is string => Boolean(label));
  const stateSuffix = normalized.startsWith('f1_') ? '(原始)' : '[Raw]';
  return labels.length ? `${labels.join('')} ${stateSuffix}` : null;
}

function isEnglishOnlyFallback(value: string): boolean {
  return /^[\x00-\x7F\s\-()./]+$/.test(value.trim());
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
  if (fallback && !isRawFactorId(fallback) && !isEnglishOnlyFallback(fallback)) {
    return fallback;
  }

  const describedName = describeRawFactorId(canonical || normalizedFactorId);
  if (describedName) {
    return describedName;
  }

  if (fallback && !isRawFactorId(fallback)) {
    return fallback;
  }

  return normalizedFactorId || fallback || '未知因子';
}

export function formatStructuredFactorDisplayName(input: {
  factorId?: unknown;
  fallbackName?: string | null;
  baseDisplayNameCn?: string | null;
  nameDedupeSuffix?: string | null;
}): string {
  const base = String(input.baseDisplayNameCn ?? '').trim();
  const suffix = String(input.nameDedupeSuffix ?? '').trim();
  if (base) {
    return suffix && suffix.startsWith('[') && !base.includes(suffix) ? `${base} ${suffix}` : base;
  }
  return formatFactorDisplayName(input.factorId, input.fallbackName);
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

export function formatFactorList(factorIds: unknown[], lookup?: FactorDisplayNameLookup): string {
  const rendered = factorIds
    .map((factorId) => formatFactorDisplayName(factorId, fallbackForFactorId(factorId, lookup)))
    .filter((item) => item.trim().length > 0);
  return rendered.length ? rendered.join(' / ') : '未选择因子';
}

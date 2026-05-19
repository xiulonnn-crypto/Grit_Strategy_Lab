const CANONICAL_FACTOR_ALIASES: Record<string, string> = {
  momentum_12m_1m: 's_mom_12m1m_rank',
  value_ep_ltm: 's_val_ep_ltm_raw',
  value_bp_latest: 's_val_bp_latest_raw',
  lowvol_realized_252d: 's_vol_252d_rank',
  size_log_market_cap: 's_size_cur_log',
  quality_roe_ltm: 's_qlty_roe_ltm_raw',
  quality_fcf_yield: 's_qlty_fcfy_ttm_raw',
  m_alpha_overnight_21d_raw: 's_f2_mom_ovn_mean_21d',
};

const CANONICAL_FACTOR_DISPLAY_NAMES: Record<string, string> = {
  a_alpha_custom_cur_raw: '风险调整现金流回报 (精炼版)',
  a_mom_ret_126d_z: '126日收益动量标准化因子',
  s_f2_mom_ovn_mean_21d: '21日隔夜动量均值',
  s_alpha_ffblend_cur_rank: '法玛-弗伦奇风格合成阿尔法排名',
  s_alpha_ffblend_resid_mkt_rank: '法玛-弗伦奇市场残差合成阿尔法排名',
  s_alpha_valvol_blend_resid_std_rk: '风险调整现金流回报 (精炼版)',
  s_mom_12m1m_rank: '12-1月截面动量排名',
  s_mom_6m_rank: '6月截面动量排名',
  s_val_ep_ltm_raw: '滚动市盈率倒数 (LTM)',
  s_val_bp_latest_raw: '最新账面市值比',
  s_qlty_roe_ltm_raw: '滚动净资产收益率 (LTM)',
  s_qlty_fcfy_ttm_raw: '自由现金流收益率 (TTM)',
  s_vol_252d_rank: '252日实现波动率排名',
  s_vol_downside_252d_rank: '252日下行波动率排名',
  s_size_cur_log: '市值规模对数',
  s_liq_turnover_20d_rank: '20日换手率流动性排名',
  s_beta_market_252d_raw: '252日市场贝塔',
};

export type FactorDisplayNameLookup = Record<string, string | null | undefined>;

const FACTOR_TOKEN_LABELS: Record<string, string> = {
  a: '自动挖掘',
  s: '截面',
  m: '市场',
  alpha: '阿尔法',
  amihud: 'Amihud流动性',
  assetgrowth: '资产增长',
  beta: '贝塔',
  bp: '账面市值比',
  capex: '资本开支',
  cur: '当前',
  downside: '下行',
  ep: '盈利价格比',
  f2: 'F2',
  fcfy: '自由现金流收益率',
  ffblend: '法玛-弗伦奇风格合成',
  inv: '投资',
  latest: '最新',
  liq: '流动性',
  log: '对数',
  ltm: '最近十二个月',
  market: '市场',
  mom: '动量',
  mean: '均值',
  ovn: '隔夜',
  qlty: '质量',
  rank: '排名',
  raw: '原始值',
  ret: '收益',
  roe: '净资产收益率',
  size: '规模',
  turnover: '换手率',
  ttm: '过去十二个月',
  val: '估值',
  valvol: '价值/波动比',
  vol: '波动率',
  z: 'Z分数',
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
  const unitMap: Record<string, string> = {
    d: '日',
    m: '月',
    y: '年',
  };
  return `${match[1]}${unitMap[match[2].toLowerCase()] ?? match[2]}`;
}

function describeRawFactorId(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!isRawFactorId(normalized)) return null;
  const tokens = normalized.split('_').filter(Boolean);
  const labels = tokens
    .map((token) => formatWindowToken(token) ?? FACTOR_TOKEN_LABELS[token] ?? null)
    .filter((label): label is string => Boolean(label));
  return labels.length ? labels.join('') : null;
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

export function formatFactorList(factorIds: unknown[], lookup?: FactorDisplayNameLookup): string {
  const rendered = factorIds
    .map((factorId) => formatFactorDisplayName(factorId, fallbackForFactorId(factorId, lookup)))
    .filter((item) => item.trim().length > 0);
  return rendered.length ? rendered.join(' / ') : '未配置因子';
}

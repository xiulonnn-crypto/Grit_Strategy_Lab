import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import type {
  ApiConfirmationFieldEntry,
  ApiSnapshotOverview,
  ApiStrategyCreationSession,
  AssetAllocationRecommendedWeight,
  ParameterValue,
} from '../types';
import './asset-allocation-config-page.css';

type InvestmentMode = 'all_in' | 'dca';
type RebalanceFrequency = 'monthly' | 'quarterly' | 'semiannual' | 'yearly';

type AllocationAsset = {
  symbol: string;
  displayName: string;
  assetClass: string;
  weightPct: number;
};

type SnapshotAssetOption = {
  symbol: string;
  label: string;
  sourceLabel: string;
  assetClass: string;
};

type BenchmarkOption = {
  symbol: string;
  label: string;
};

type AllocationFormState = {
  strategyName: string;
  strategyDescription: string;
  benchmarkSymbol: string;
  capital: number;
  investmentMode: InvestmentMode;
  contributionAmount: number;
  investmentFrequency: RebalanceFrequency;
  rebalanceEnabled: boolean;
  rebalanceFrequency: RebalanceFrequency;
  rebalanceThresholdPct: number;
  costModelEnabled: boolean;
  feeBps: number;
  slippageBps: number;
  expenseRatioBps: number;
};

const DEFAULT_FORM: AllocationFormState = {
  strategyName: '全球资产配置策略',
  strategyDescription: '多资产风险预算、目标权重、再平衡与成本假设。',
  benchmarkSymbol: 'SPY',
  capital: 100000,
  investmentMode: 'all_in',
  contributionAmount: 1000,
  investmentFrequency: 'monthly',
  rebalanceEnabled: true,
  rebalanceFrequency: 'quarterly',
  rebalanceThresholdPct: 5,
  costModelEnabled: true,
  feeBps: 1.5,
  slippageBps: 2.5,
  expenseRatioBps: 8,
};

const FREQUENCY_OPTIONS: Array<{ value: RebalanceFrequency; label: string }> = [
  { value: 'monthly', label: '月度' },
  { value: 'quarterly', label: '季度' },
  { value: 'semiannual', label: '半年' },
  { value: 'yearly', label: '年度' },
];

const LEGACY_DEFAULT_ASSET_SIGNATURE = 'SPY:35|QQQ:25|TLT:25|GLD:15';
const FIRST_SCREEN_DEFER_MS = import.meta.env.MODE === 'test' ? 0 : 1200;

function normalizeSymbol(value: string): string {
  return value.trim().toUpperCase().replace(/\.US$/, '');
}

function formatPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatWeightInputValue(value: number): string {
  return `${(Number.isFinite(value) ? value : 0).toFixed(1)}`;
}

function roundNumber(value: number, digits = 4): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function normalizeWeightPct(value: number): number {
  return roundNumber(Number.isFinite(value) ? value : 0, 1);
}

function numberFromInput(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .map((item) => (typeof item === 'string' ? normalizeSymbol(item) : ''))
        .filter(Boolean)
    : [];
}

function findPriceSnapshot(overview: ApiSnapshotOverview | null): ApiSnapshotOverview['dataset_snapshots'][number] | null {
  return overview?.dataset_snapshots.find((item) => item.id === 'ds-price') ?? null;
}

function benchmarkCoverageSymbols(overview: ApiSnapshotOverview | null): SnapshotAssetOption[] {
  const symbols = findPriceSnapshot(overview)?.metadata?.benchmark_etf_coverage?.symbols ?? [];
  return symbols
    .map((item) => {
      const symbol = normalizeSymbol(item.symbol ?? '');
      if (!symbol || item.status !== 'READY') {
        return null;
      }
      const range = item.start_date && item.end_date ? `${item.start_date} 至 ${item.end_date}` : '价格历史';
      return {
        symbol,
        label: `${symbol} · ${range}`,
        sourceLabel: '指数与基准',
        assetClass: '股票',
      } satisfies SnapshotAssetOption;
    })
    .filter((item): item is SnapshotAssetOption => item !== null);
}

function bondSnapshotSymbols(overview: ApiSnapshotOverview | null): SnapshotAssetOption[] {
  const instruments = overview?.bond_fixed_income?.eligible_instruments ?? [];
  return instruments
    .map((instrument) => {
      const record = instrument as typeof instrument & {
        can_enter_risk_budget?: boolean;
        asset_leg_disabled_reason?: string | null;
      };
      const symbol = normalizeSymbol(record.symbol || record.id || '');
      const blocked = record.can_enter_risk_budget === false || Boolean(record.asset_leg_disabled_reason);
      if (!symbol || blocked) {
        return null;
      }
      return {
        symbol,
        label: `${symbol} · ${record.label}`,
        sourceLabel: '债券快照',
        assetClass: '债券',
      } satisfies SnapshotAssetOption;
    })
    .filter((item): item is SnapshotAssetOption => item !== null);
}

function buildSnapshotAssetOptions(overview: ApiSnapshotOverview | null): SnapshotAssetOption[] {
  const metadata = findPriceSnapshot(overview)?.metadata;
  const symbols = [
    ...arrayOfStrings(metadata?.selected_latest_symbols),
    ...arrayOfStrings(metadata?.selected_symbols),
    ...arrayOfStrings(metadata?.covered_symbols),
  ];
  const bySymbol = new Map<string, SnapshotAssetOption>();
  for (const symbol of symbols) {
    bySymbol.set(symbol, { symbol, label: `${symbol} · 价格快照`, sourceLabel: '价格快照', assetClass: '股票' });
  }
  for (const option of benchmarkCoverageSymbols(overview)) {
    bySymbol.set(option.symbol, option);
  }
  for (const option of bondSnapshotSymbols(overview)) {
    bySymbol.set(option.symbol, option);
  }
  return [...bySymbol.values()].sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function buildBenchmarkOptions(overview: ApiSnapshotOverview | null, fallbackSymbol: string): BenchmarkOption[] {
  const coverageOptions = benchmarkCoverageSymbols(overview).map((item) => ({
    symbol: item.symbol,
    label: item.label,
  }));
  if (coverageOptions.length) {
    return coverageOptions;
  }
  const symbol = normalizeSymbol(fallbackSymbol || 'SPY');
  return symbol ? [{ symbol, label: `${symbol} · 当前基准` }] : [];
}

function assetSignature(assets: AllocationAsset[]): string {
  return assets.map((asset) => `${asset.symbol}:${roundNumber(asset.weightPct, 4)}`).join('|');
}

function isLegacyDefaultAssetSet(assets: AllocationAsset[]): boolean {
  return assetSignature(assets) === LEGACY_DEFAULT_ASSET_SIGNATURE;
}

function fuzzyMatch(value: string, query: string): boolean {
  const normalizedValue = value.toLowerCase();
  const normalizedQuery = query.toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  if (normalizedValue.includes(normalizedQuery)) {
    return true;
  }
  let cursor = 0;
  for (const character of normalizedQuery) {
    cursor = normalizedValue.indexOf(character, cursor);
    if (cursor === -1) {
      return false;
    }
    cursor += 1;
  }
  return true;
}

function getEntryValue(entries: ApiConfirmationFieldEntry[] | undefined, key: string): unknown {
  return entries?.find((entry) => entry.key === key)?.value;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readFrequency(value: unknown, fallback: RebalanceFrequency): RebalanceFrequency {
  return value === 'monthly' || value === 'quarterly' || value === 'semiannual' || value === 'yearly'
    ? value
    : fallback;
}

function readInvestmentMode(value: unknown): InvestmentMode {
  return value === 'dca' ? 'dca' : 'all_in';
}

function hydrateFromSession(session: ApiStrategyCreationSession): {
  form: AllocationFormState;
  assets: AllocationAsset[];
} {
  const parameterEntries = session.confirmation_fields?.parameters ?? [];
  const assetsValue = getEntryValue(parameterEntries, 'allocation_assets');
  const assets = Array.isArray(assetsValue)
    ? assetsValue
        .map((item) => {
          if (!item || typeof item !== 'object') {
            return null;
          }
          const record = item as Record<string, unknown>;
          const symbol = normalizeSymbol(readString(record.symbol, ''));
          if (!symbol) {
            return null;
          }
          return {
            symbol,
            displayName: readString(record.display_name, symbol),
            assetClass: readString(record.asset_class, 'Asset'),
            weightPct: normalizeWeightPct(readNumber(getEntryValue(parameterEntries, `allocation_weight__${symbol}_pct`), 0)),
          } satisfies AllocationAsset;
        })
        .filter((asset): asset is AllocationAsset => asset !== null)
    : [];
  return {
    form: {
      strategyName: readString(getEntryValue(parameterEntries, 'strategy_name'), DEFAULT_FORM.strategyName),
      strategyDescription: readString(
        getEntryValue(parameterEntries, 'strategy_description'),
        DEFAULT_FORM.strategyDescription,
      ),
      benchmarkSymbol: normalizeSymbol(readString(getEntryValue(parameterEntries, 'benchmark_symbol'), 'SPY')),
      capital: readNumber(getEntryValue(parameterEntries, 'capital'), DEFAULT_FORM.capital),
      investmentMode: readInvestmentMode(getEntryValue(parameterEntries, 'investment_mode')),
      contributionAmount: readNumber(
        getEntryValue(parameterEntries, 'contribution_amount'),
        DEFAULT_FORM.contributionAmount,
      ),
      investmentFrequency: readFrequency(
        getEntryValue(parameterEntries, 'investment_frequency'),
        DEFAULT_FORM.investmentFrequency,
      ),
      rebalanceEnabled: readBoolean(
        getEntryValue(parameterEntries, 'rebalance_enabled'),
        DEFAULT_FORM.rebalanceEnabled,
      ),
      rebalanceFrequency: readFrequency(
        getEntryValue(parameterEntries, 'rebalance_frequency'),
        DEFAULT_FORM.rebalanceFrequency,
      ),
      rebalanceThresholdPct: readNumber(
        getEntryValue(parameterEntries, 'rebalance_threshold_pct'),
        DEFAULT_FORM.rebalanceThresholdPct,
      ),
      costModelEnabled: readBoolean(
        getEntryValue(parameterEntries, 'cost_model_enabled'),
        DEFAULT_FORM.costModelEnabled,
      ),
      feeBps: readNumber(getEntryValue(parameterEntries, 'fee_bps'), DEFAULT_FORM.feeBps),
      slippageBps: readNumber(getEntryValue(parameterEntries, 'slippage_bps'), DEFAULT_FORM.slippageBps),
      expenseRatioBps: readNumber(
        getEntryValue(parameterEntries, 'expense_ratio_bps'),
        DEFAULT_FORM.expenseRatioBps,
      ),
    },
    assets: isLegacyDefaultAssetSet(assets) ? [] : assets,
  };
}

function createIdempotencyKey(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}`;
}

function buildParameterSnapshot(
  form: AllocationFormState,
  assets: AllocationAsset[],
): Record<string, ParameterValue> {
  const snapshot: Record<string, ParameterValue> = {
    strategy_type: 'ASSET_ALLOCATION',
    strategy_name: form.strategyName,
    strategy_description: form.strategyDescription,
    benchmark_symbol: form.benchmarkSymbol,
    capital: form.capital,
    allocation_assets: assets.map((asset) => ({
      symbol: asset.symbol,
      display_name: asset.displayName,
      asset_class: asset.assetClass,
    })),
    investment_mode: form.investmentMode,
    contribution_amount: form.contributionAmount,
    investment_frequency: form.investmentFrequency,
    rebalance_enabled: form.rebalanceEnabled,
    rebalance_frequency: form.rebalanceFrequency,
    rebalance_threshold_pct: form.rebalanceThresholdPct,
    cost_model_enabled: form.costModelEnabled,
    fee_bps: form.feeBps,
    slippage_bps: form.slippageBps,
    expense_ratio_bps: form.expenseRatioBps,
  };
  for (const asset of assets) {
    snapshot[`allocation_weight__${asset.symbol}_pct`] = normalizeWeightPct(asset.weightPct);
  }
  return snapshot;
}

export function AssetAllocationConfigPage({ sessionId }: { sessionId?: string }): JSX.Element {
  const api = useApiClient();
  const [session, setSession] = useState<ApiStrategyCreationSession | null>(null);
  const [form, setForm] = useState<AllocationFormState>(DEFAULT_FORM);
  const [assets, setAssets] = useState<AllocationAsset[]>([]);
  const [newSymbol, setNewSymbol] = useState('');
  const [newAssetClass, setNewAssetClass] = useState('');
  const [isAssetPickerOpen, setIsAssetPickerOpen] = useState(false);
  const [weightDrafts, setWeightDrafts] = useState<Record<string, string>>({});
  const [recommendation, setRecommendation] = useState<AssetAllocationRecommendedWeight[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotOverview, setSnapshotOverview] = useState<ApiSnapshotOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRecommending, setIsRecommending] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function initialize(): Promise<void> {
      setIsLoading(true);
      setErrorMessage(null);
      try {
        const nextSession = sessionId
          ? await api.getCreationSession(sessionId)
          : await api.createCreationSession({ strategy_type: 'ASSET_ALLOCATION' });
        if (cancelled) {
          return;
        }
        setSession(nextSession);
        const hydrated = hydrateFromSession(nextSession);
        setForm(hydrated.form);
        setAssets(hydrated.assets);
        if (!sessionId) {
          navigateTo(`/creation/asset-allocation/new?session_id=${encodeURIComponent(nextSession.id)}`);
        }
      } catch (caught) {
        if (!cancelled) {
          setErrorMessage((caught as Error).message);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [api, sessionId]);

  useEffect(() => {
    let cancelled = false;
    async function loadSnapshotOverview(): Promise<void> {
      setSnapshotError(null);
      try {
        await new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_DEFER_MS));
        if (cancelled) {
          return;
        }
        const overview = await api.getSnapshotOverview();
        if (!cancelled) {
          setSnapshotOverview(overview);
        }
      } catch (caught) {
        if (!cancelled) {
          setSnapshotError((caught as Error).message);
        }
      }
    }
    void loadSnapshotOverview();
    return () => {
      cancelled = true;
    };
  }, [api]);

  const weightTotal = useMemo(
    () => assets.reduce((total, asset) => total + (Number.isFinite(asset.weightPct) ? asset.weightPct : 0), 0),
    [assets],
  );
  const weightDelta = Math.abs(weightTotal - 100);
  const weightIsValid = assets.length > 0 && weightDelta <= 0.1;
  const estimatedCostBps = form.costModelEnabled
    ? form.feeBps + form.slippageBps + form.expenseRatioBps
    : 0;
  const parameterSnapshot = useMemo(() => buildParameterSnapshot(form, assets), [assets, form]);
  const assetOptions = useMemo(() => buildSnapshotAssetOptions(snapshotOverview), [snapshotOverview]);
  const benchmarkOptions = useMemo(
    () => buildBenchmarkOptions(snapshotOverview, form.benchmarkSymbol),
    [form.benchmarkSymbol, snapshotOverview],
  );
  const filteredAssetOptions = useMemo(() => {
    const selectedSymbols = new Set(assets.map((asset) => asset.symbol));
    const query = newSymbol.trim().toLowerCase();
    const candidates = assetOptions.filter((option) => !selectedSymbols.has(option.symbol));
    if (!query) {
      return [];
    }
    return candidates
      .filter((option) => fuzzyMatch(`${option.symbol} ${option.label}`, query))
      .slice(0, 8);
  }, [assetOptions, assets, newSymbol]);
  const showAssetOptions = isAssetPickerOpen && filteredAssetOptions.length > 0;

  useEffect(() => {
    if (!snapshotOverview || !assetOptions.length) {
      return;
    }
    const availableSymbols = new Set(assetOptions.map((option) => option.symbol));
    setAssets((current) => current.filter((asset) => availableSymbols.has(asset.symbol)));
  }, [assetOptions, snapshotOverview]);

  useEffect(() => {
    if (!snapshotOverview || !benchmarkOptions.length) {
      return;
    }
    setForm((current) =>
      benchmarkOptions.some((option) => option.symbol === current.benchmarkSymbol)
        ? current
        : { ...current, benchmarkSymbol: benchmarkOptions[0].symbol },
    );
  }, [benchmarkOptions, snapshotOverview]);

  function updateForm<K extends keyof AllocationFormState>(key: K, value: AllocationFormState[K]): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateAsset(symbol: string, patch: Partial<AllocationAsset>): void {
    setAssets((current) =>
      current.map((asset) => (asset.symbol === symbol ? { ...asset, ...patch } : asset)),
    );
  }

  function updateWeightDraft(symbol: string, rawValue: string, fallback: number): void {
    setWeightDrafts((current) => ({ ...current, [symbol]: rawValue }));
    updateAsset(symbol, { weightPct: numberFromInput(rawValue, fallback) });
  }

  function commitWeightDraft(symbol: string, rawValue: string, fallback: number): void {
    updateAsset(symbol, { weightPct: normalizeWeightPct(numberFromInput(rawValue, fallback)) });
    setWeightDrafts((current) => {
      const next = { ...current };
      delete next[symbol];
      return next;
    });
  }

  function addAsset(): void {
    const symbol = normalizeSymbol(newSymbol);
    const option = assetOptions.find((item) => item.symbol === symbol);
    if (!option) {
      setErrorMessage('请选择数据快照中已有标的。');
      return;
    }
    if (!symbol || assets.some((asset) => asset.symbol === symbol)) {
      return;
    }
    setAssets((current) => [
      ...current,
      {
        symbol,
        displayName: option.label,
        assetClass: newAssetClass.trim() || option.assetClass,
        weightPct: 0,
      },
    ]);
    setNewSymbol('');
    setNewAssetClass('');
    setIsAssetPickerOpen(false);
    setRecommendation([]);
    setErrorMessage(null);
  }

  function removeAsset(symbol: string): void {
    setAssets((current) => current.filter((asset) => asset.symbol !== symbol));
    setWeightDrafts((current) => {
      const next = { ...current };
      delete next[symbol];
      return next;
    });
  }

  async function ensureSession(): Promise<ApiStrategyCreationSession> {
    if (session) {
      return session;
    }
    const nextSession = await api.createCreationSession({ strategy_type: 'ASSET_ALLOCATION' });
    setSession(nextSession);
    navigateTo(`/creation/asset-allocation/new?session_id=${encodeURIComponent(nextSession.id)}`);
    return nextSession;
  }

  async function persistConfiguration(materialize: boolean): Promise<void> {
    if (!weightIsValid) {
      setErrorMessage('目标权重需合计 100%。');
      return;
    }
    setIsSaving(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const activeSession = await ensureSession();
      const updatedSession = await api.updateConfirmation(activeSession.id, {
        revision: activeSession.revision ?? 1,
        strategy_type: 'ASSET_ALLOCATION',
        core: {
          strategy_type: 'ASSET_ALLOCATION',
          universe_name: 'Global Allocation',
          rebalance_frequency: form.rebalanceFrequency,
        },
        parameters: parameterSnapshot,
      });
      setSession(updatedSession);
      if (materialize) {
        const strategy = await api.materializeStrategy(
          updatedSession.id,
          createIdempotencyKey('asset-allocation'),
          updatedSession.revision,
        );
        navigateTo(`/strategies/${encodeURIComponent(strategy.id)}`);
        return;
      }
      setStatusMessage('配置已保存。后续详情、回测与优化沿用现有策略页面。');
    } catch (caught) {
      setErrorMessage((caught as Error).message);
    } finally {
      setIsSaving(false);
    }
  }

  async function requestRecommendation(): Promise<void> {
    if (assets.length < 2) {
      setErrorMessage('请先选择至少两个数据快照标的。');
      return;
    }
    setIsRecommending(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const activeSession = await ensureSession();
      if (!api.recommendAssetAllocationWeights) {
        throw new Error('当前运行环境未启用资产配置推荐权重接口。');
      }
      const response = await api.recommendAssetAllocationWeights(activeSession.id, {
        assets: assets.map((asset) => ({
          symbol: asset.symbol,
          display_name: asset.displayName,
          asset_class: asset.assetClass,
          target_weight_pct: asset.weightPct,
        })),
        lookback_days: 252,
      });
      setRecommendation(response.weights);
      setStatusMessage(response.warnings?.[0] ?? '风险预算权重已生成。');
    } catch (caught) {
      setErrorMessage((caught as Error).message);
    } finally {
      setIsRecommending(false);
    }
  }

  function applyRecommendation(): void {
    if (!recommendation.length) {
      return;
    }
    setAssets((current) =>
      current.map((asset) => {
        const recommended = recommendation.find((item) => item.symbol === asset.symbol);
        return recommended ? { ...asset, weightPct: normalizeWeightPct(recommended.target_weight_pct) } : asset;
      }),
    );
    setWeightDrafts({});
    setStatusMessage('推荐权重已应用。');
  }

  return (
    <main className="asset-allocation-page" data-testid="asset-allocation-config-page">
      <section className="asset-allocation-hero">
        <div>
          <span className="asset-allocation-eyebrow">Global Allocation</span>
          <h1>资产配置策略配置</h1>
          <p>配置标的、目标权重、再平衡与成本参数。回测、运行详情和优化配置不创建第二套资产配置报告。</p>
        </div>
      </section>

      {errorMessage ? <div className="asset-allocation-alert" role="alert">{errorMessage}</div> : null}
      {statusMessage ? <div className="asset-allocation-alert asset-allocation-alert--success">{statusMessage}</div> : null}
      {snapshotError ? <div className="asset-allocation-alert" role="alert">数据快照读取失败：{snapshotError}</div> : null}

      <div className="asset-allocation-layout" aria-busy={isLoading}>
        <section className="asset-allocation-stack">
          <section className="asset-allocation-panel">
            <div className="asset-allocation-section-head">
              <div>
                <span>Allocation Basket</span>
                <h2>标的与权重</h2>
              </div>
              <strong className={weightIsValid ? 'asset-allocation-good' : 'asset-allocation-warn'}>
                合计 {formatPct(weightTotal)}
              </strong>
            </div>
            <div className="asset-allocation-table-wrap">
              <table className="asset-allocation-table">
                <thead>
                  <tr>
                    <th>标的</th>
                    <th>资产类别</th>
                    <th>目标权重(%)</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.length ? (
                    assets.map((asset) => (
                      <tr key={asset.symbol}>
                        <td>
                          <strong>{asset.symbol}</strong>
                          <small className="asset-allocation-symbol-label">{asset.displayName}</small>
                        </td>
                        <td>
                          <input
                            aria-label={`${asset.symbol} asset class`}
                            onChange={(event) => updateAsset(asset.symbol, { assetClass: event.target.value })}
                            value={asset.assetClass}
                          />
                        </td>
                        <td>
                          <input
                            aria-label={`${asset.symbol} target weight`}
                            min="0"
                            onBlur={(event) => commitWeightDraft(asset.symbol, event.target.value, asset.weightPct)}
                            onChange={(event) => updateWeightDraft(asset.symbol, event.target.value, asset.weightPct)}
                            step="0.1"
                            type="number"
                            value={weightDrafts[asset.symbol] ?? formatWeightInputValue(asset.weightPct)}
                          />
                        </td>
                        <td>
                          <button
                            className="asset-allocation-ghost"
                            onClick={() => removeAsset(asset.symbol)}
                            type="button"
                          >
                            移除
                          </button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td className="asset-allocation-empty-cell" colSpan={4}>
                        暂无标的。请从数据快照中选择。
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="asset-allocation-add-row">
              <div className="asset-allocation-combobox">
                <input
                  aria-controls="asset-allocation-symbol-options"
                  aria-expanded={showAssetOptions}
                  aria-label="新增标的代码"
                  autoComplete="off"
                  onChange={(event) => {
                    setNewSymbol(event.target.value);
                    setNewAssetClass('');
                    setIsAssetPickerOpen(event.target.value.trim().length > 0);
                  }}
                  onFocus={() => setIsAssetPickerOpen(newSymbol.trim().length > 0)}
                  placeholder="搜索数据快照标的"
                  role="combobox"
                  value={newSymbol}
                />
                {showAssetOptions ? (
                  <div
                    className="asset-allocation-combobox__list"
                    id="asset-allocation-symbol-options"
                    role="listbox"
                  >
                    {filteredAssetOptions.map((option) => (
                      <button
                        key={option.symbol}
                        onClick={() => {
                          setNewSymbol(option.symbol);
                          setNewAssetClass(option.assetClass);
                          setIsAssetPickerOpen(false);
                        }}
                        role="option"
                        type="button"
                      >
                        <strong>{option.symbol}</strong>
                        <span>{option.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <input
                aria-label="新增资产类别"
                onChange={(event) => setNewAssetClass(event.target.value)}
                placeholder="资产类别"
                value={newAssetClass}
              />
              <button onClick={addAsset} type="button">添加标的</button>
            </div>
          </section>

          <section className="asset-allocation-panel asset-allocation-split-panel">
            <div>
              <div className="asset-allocation-section-head">
                <div>
                  <span>Risk Budget</span>
                  <h2>风险平价权重</h2>
                </div>
              </div>
              <p>以近 252 个交易日波动率估算风险预算，仅对价格历史完整标的生成推荐。</p>
              <div className="asset-allocation-actions">
                <button
                  disabled={isRecommending || isLoading || assets.length < 2}
                  onClick={() => void requestRecommendation()}
                  type="button"
                >
                  {isRecommending ? '计算中...' : '生成推荐权重'}
                </button>
                <button
                  className="asset-allocation-secondary"
                  disabled={!recommendation.length}
                  onClick={applyRecommendation}
                  type="button"
                >
                  应用推荐
                </button>
              </div>
            </div>
            <div className="asset-allocation-recommendation-list">
              {assets.length ? (recommendation.length ? recommendation : assets.map((asset) => ({
                symbol: asset.symbol,
                target_weight_pct: asset.weightPct,
                risk_contribution_pct: 100 / assets.length,
                data_status: 'manual',
              }))).map((item) => (
                <div className="asset-allocation-recommendation-row" key={item.symbol}>
                  <span>{item.symbol}</span>
                  <strong>{formatPct(item.target_weight_pct)}</strong>
                  <small>{formatPct(item.risk_contribution_pct)} risk</small>
                </div>
              )) : <p className="asset-allocation-muted">添加至少两个标的后生成推荐权重。</p>}
            </div>
          </section>

          <section className="asset-allocation-panel">
            <div className="asset-allocation-section-head">
              <div>
                <span>Parameter Snapshot</span>
                <h2>参数快照</h2>
              </div>
            </div>
            <div className="asset-allocation-snapshot-grid">
              <span>strategy_type</span>
              <strong>ASSET_ALLOCATION</strong>
              <span>rebalance_frequency</span>
              <strong>{form.rebalanceFrequency}</strong>
              <span>cost_model</span>
              <strong>{form.costModelEnabled ? `${estimatedCostBps.toFixed(1)} bps` : 'off'}</strong>
              <span>allocation_assets</span>
              <strong>{assets.length ? assets.map((asset) => asset.symbol).join(' / ') : '-'}</strong>
            </div>
          </section>
        </section>

        <aside className="asset-allocation-rail">
          <section className="asset-allocation-panel">
            <div className="asset-allocation-section-head">
              <div>
                <span>Profile</span>
                <h2>策略档案</h2>
              </div>
            </div>
            <label>
              策略名称
              <input
                onChange={(event) => updateForm('strategyName', event.target.value)}
                value={form.strategyName}
              />
            </label>
            <label>
              策略说明
              <textarea
                onChange={(event) => updateForm('strategyDescription', event.target.value)}
                rows={3}
                value={form.strategyDescription}
              />
            </label>
            <label>
              基准
              <select
                onChange={(event) => updateForm('benchmarkSymbol', normalizeSymbol(event.target.value))}
                value={form.benchmarkSymbol}
              >
                {benchmarkOptions.map((option) => (
                  <option key={option.symbol} value={option.symbol}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              初始资金
              <input
                min="1"
                onChange={(event) => updateForm('capital', numberFromInput(event.target.value, form.capital))}
                type="number"
                value={form.capital}
              />
            </label>
          </section>

          <section className="asset-allocation-panel">
            <div className="asset-allocation-section-head">
              <div>
                <span>Execution</span>
                <h2>配置类型</h2>
              </div>
            </div>
            <div className="asset-allocation-segmented">
              <button
                aria-pressed={form.investmentMode === 'all_in'}
                onClick={() => updateForm('investmentMode', 'all_in')}
                type="button"
              >
                All-in
              </button>
              <button
                aria-pressed={form.investmentMode === 'dca'}
                onClick={() => updateForm('investmentMode', 'dca')}
                type="button"
              >
                定投
              </button>
            </div>
            <label>
              定投金额
              <input
                disabled={form.investmentMode !== 'dca'}
                min="0"
                onChange={(event) =>
                  updateForm('contributionAmount', numberFromInput(event.target.value, form.contributionAmount))
                }
                type="number"
                value={form.contributionAmount}
              />
            </label>
            <label>
              定投频率
              <select
                disabled={form.investmentMode !== 'dca'}
                onChange={(event) => updateForm('investmentFrequency', event.target.value as RebalanceFrequency)}
                value={form.investmentFrequency}
              >
                {FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          </section>

          <section className="asset-allocation-panel">
            <div className="asset-allocation-switch-row">
              <div>
                <span>Rebalance</span>
                <h2>再平衡</h2>
              </div>
              <input
                aria-label="再平衡开关"
                checked={form.rebalanceEnabled}
                onChange={(event) => updateForm('rebalanceEnabled', event.target.checked)}
                type="checkbox"
              />
            </div>
            <label>
              再平衡频率
              <select
                disabled={!form.rebalanceEnabled}
                onChange={(event) => updateForm('rebalanceFrequency', event.target.value as RebalanceFrequency)}
                value={form.rebalanceFrequency}
              >
                {FREQUENCY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              偏离阈值
              <input
                disabled={!form.rebalanceEnabled}
                min="0"
                onChange={(event) =>
                  updateForm('rebalanceThresholdPct', numberFromInput(event.target.value, form.rebalanceThresholdPct))
                }
                step="0.5"
                type="number"
                value={form.rebalanceThresholdPct}
              />
            </label>
          </section>

          <section className="asset-allocation-panel">
            <div className="asset-allocation-switch-row">
              <div>
                <span>Cost</span>
                <h2>成本模拟</h2>
              </div>
              <input
                aria-label="成本模拟开关"
                checked={form.costModelEnabled}
                onChange={(event) => updateForm('costModelEnabled', event.target.checked)}
                type="checkbox"
              />
            </div>
            <label>
              交易费 bps
              <input
                disabled={!form.costModelEnabled}
                min="0"
                onChange={(event) => updateForm('feeBps', numberFromInput(event.target.value, form.feeBps))}
                step="0.1"
                type="number"
                value={form.feeBps}
              />
            </label>
            <label>
              滑点 bps
              <input
                disabled={!form.costModelEnabled}
                min="0"
                onChange={(event) =>
                  updateForm('slippageBps', numberFromInput(event.target.value, form.slippageBps))
                }
                step="0.1"
                type="number"
                value={form.slippageBps}
              />
            </label>
            <label>
              持有成本 bps
              <input
                disabled={!form.costModelEnabled}
                min="0"
                onChange={(event) =>
                  updateForm('expenseRatioBps', numberFromInput(event.target.value, form.expenseRatioBps))
                }
                step="0.1"
                type="number"
                value={form.expenseRatioBps}
              />
            </label>
          </section>

          <section className="asset-allocation-panel asset-allocation-preflight">
            <div>
              <span>Preflight</span>
              <h2>创建检查</h2>
            </div>
            <ul>
              <li className={assets.length >= 2 ? 'asset-allocation-good' : 'asset-allocation-warn'}>标的不少于 2 个</li>
              <li className={weightIsValid ? 'asset-allocation-good' : 'asset-allocation-warn'}>目标权重合计 100%</li>
              <li className={form.rebalanceEnabled ? 'asset-allocation-good' : 'asset-allocation-muted'}>再平衡参数已配置</li>
              <li className={form.costModelEnabled ? 'asset-allocation-good' : 'asset-allocation-muted'}>成本模拟已配置</li>
            </ul>
            <div className="asset-allocation-submit-row">
              <button
                className="asset-allocation-secondary"
                disabled={isSaving || isLoading}
                onClick={() => void persistConfiguration(false)}
                type="button"
              >
                保存配置
              </button>
              <button
                disabled={isSaving || isLoading || !weightIsValid || assets.length < 2}
                onClick={() => void persistConfiguration(true)}
                type="button"
              >
                {isSaving ? '创建中...' : '创建策略'}
              </button>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

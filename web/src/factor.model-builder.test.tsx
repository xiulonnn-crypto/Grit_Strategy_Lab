import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FactorModelBuilderPage, {
  type FactorModelCreateResponse,
  type FactorModelOption,
  type FactorModelPreview,
  type FactorModelPreviewPayload,
} from './pages/factor-model-builder-page';

function makeReadyPreview(overrides: Partial<FactorModelPreview> = {}): FactorModelPreview {
  return {
    status: 'READY',
    coveragePct: 91.25,
    factorCount: 5,
    readyFactorCount: 5,
    universeSymbolCount: 10,
    turnoverPct: 18.4,
    scoreSpread: 1.37,
    scorePreview: [
      { symbol: 'NVDA', score: 0.92, coveragePct: 100 },
      { symbol: 'MSFT', score: 0.61, coveragePct: 90 },
      { symbol: 'AAPL', score: 0.44, coveragePct: 100 },
      { symbol: 'AMZN', score: 0.12, coveragePct: 90 },
      { symbol: 'META', score: -0.08, coveragePct: 100 },
      { symbol: 'GOOGL', score: -0.21, coveragePct: 90 },
      { symbol: 'TSLA', score: -0.39, coveragePct: 70 },
      { symbol: 'AMD', score: -0.45, coveragePct: 80 },
    ],
    normalizedWeights: [
      { factorId: 's_mom_12m1m_rank', weightPct: 30, normalizedWeightPct: 30, direction: 'HIGH_IS_GOOD' },
      { factorId: 's_val_ep_ltm_raw', weightPct: 20, normalizedWeightPct: 20, direction: 'HIGH_IS_GOOD' },
      { factorId: 's_qlty_fcfy_ttm_raw', weightPct: 20, normalizedWeightPct: 20, direction: 'HIGH_IS_GOOD' },
      { factorId: 's_vol_252d_rank', weightPct: 15, normalizedWeightPct: 15, direction: 'LOW_IS_GOOD' },
      { factorId: 's_size_cur_log', weightPct: 15, normalizedWeightPct: 15, direction: 'LOW_IS_GOOD' },
    ],
    pitBlockers: [],
    neutralizationStatus: {
      enabled: false,
      method: 'industry',
      status: 'DISABLED',
      blockers: [],
    },
    warnings: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  window.location.hash = '';
});

describe('FactorModelBuilderPage', () => {
  it('renders the V1.7 model builder hero, basket, preview, neutralization, and gates', () => {
    render(<FactorModelBuilderPage />);

    expect(document.querySelector('[data-page-root="factor-model-builder"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '多因子策略创建' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存草稿' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '选择因子' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '权重与打分预览' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '策略门禁' })).toBeInTheDocument();
    expect(screen.getByText('12-1月截面动量排名')).toBeInTheDocument();
    expect(screen.getByText('滚动市盈率倒数 (LTM)')).toBeInTheDocument();
    expect(screen.getByText('自由现金流收益率 (TTM)')).toBeInTheDocument();
    expect(screen.getByText('即时对数总市值')).toBeInTheDocument();
    expect(screen.getByLabelText('策略名称')).toHaveValue('多因子核心模型');
    expect(screen.getByRole('button', { name: '启用行业中性化' })).toBeInTheDocument();
    expect(screen.getByLabelText('12-1月截面动量排名权重')).toBeInTheDocument();
    expect(screen.getAllByText('GICS Level 1 · PIT Snapshot · ZScore 后残差化')[0]).toBeInTheDocument();
    expect(screen.getByText('基础面 available_at 校验')).toBeInTheDocument();
    expect(screen.getByText('MULTI_FACTOR')).toBeInTheDocument();
    expect(screen.getByText('得分分布跨度')).toBeInTheDocument();
    expect(screen.getByText('等待预览接口返回样本')).toBeInTheDocument();
    expect(screen.getByText('零写入打分样本')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();
  });

  it('hydrates weights, score samples, and gate status through the injected preview API', async () => {
    const preview = makeReadyPreview();
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(preview);

    render(<FactorModelBuilderPage api={{ previewFactorModel }} />);

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(1));
    expect(previewFactorModel.mock.calls[0][0]).toMatchObject({
      modelName: '多因子核心模型',
      rebalanceFrequency: 'monthly',
      neutralization: {
        enabled: false,
        taxonomy: 'GICS',
        level: 'Level 1',
        method: 'ZScore 后残差化',
      },
    });
    expect(previewFactorModel.mock.calls[0][0].factors.map((factor) => factor.weightPct)).toEqual([
      30,
      20,
      20,
      15,
      15,
    ]);
    expect(await screen.findByText('91.3%')).toBeInTheDocument();
    expect(screen.getByText('18.4%')).toBeInTheDocument();
    expect(screen.getAllByText('1.37')[0]).toBeInTheDocument();
    expect(screen.getByText('样本 8 个 · 分布跨度 1.37')).toBeInTheDocument();
    expect(screen.getByText('READY')).toBeInTheDocument();
  });

  it('initializes live factors without design preset weights when the API does not provide suggestions', async () => {
    const liveFactors: FactorModelOption[] = [
      ['s_mom_12m1m_rank', 'API 动量', '动量', 'HIGH_IS_GOOD'],
      ['s_val_ep_ltm_raw', 'API 估值', '估值', 'HIGH_IS_GOOD'],
      ['s_qlty_fcfy_ttm_raw', 'API 质量', '质量', 'HIGH_IS_GOOD'],
      ['s_vol_252d_rank', 'API 低波', '低波', 'LOW_IS_GOOD'],
      ['s_size_cur_log', 'API 规模', '规模', 'LOW_IS_GOOD'],
    ].map(([id, displayName, family, direction]) => ({
      id,
      displayName,
      family,
      sourceLabel: '系统默认',
      diagnosticStatus: 'READY',
      pitCoveragePct: 100,
      defaultWeight: 0,
      defaultDirection: direction as FactorModelOption['defaultDirection'],
    }));
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview());

    render(
      <FactorModelBuilderPage
        api={{ previewFactorModel }}
        factors={liveFactors}
        useDefaultFallback={false}
      />,
    );

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(1));
    expect(screen.getByText('API 动量')).toBeInTheDocument();
    expect(screen.queryByText('12-1月截面动量排名')).not.toBeInTheDocument();
    expect(previewFactorModel.mock.calls[0][0].factors.map((factor) => factor.weightPct)).toEqual([
      20,
      20,
      20,
      20,
      20,
    ]);
  });

  it('does not render default factor data when the live factor API returns no candidates', () => {
    render(<FactorModelBuilderPage factors={[]} useDefaultFallback={false} />);

    expect(screen.getByText('因子接口未返回可用因子，当前无法创建策略。')).toBeInTheDocument();
    expect(screen.queryByText('12-1月截面动量排名')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();
  });

  it('lets selected factor weights be adjusted and sends the new weights to preview', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview());

    render(<FactorModelBuilderPage api={{ previewFactorModel }} />);

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText('12-1月截面动量排名权重'), { target: { value: '25' } });

    const weightRow = screen.getByText('权重合计').closest('.audit-row');
    expect(weightRow).not.toBeNull();
    expect(within(weightRow as HTMLElement).getByText('95%')).toBeInTheDocument();
    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(2));
    expect(previewFactorModel.mock.calls.at(-1)?.[0].factors[0]).toMatchObject({
      factorId: 's_mom_12m1m_rank',
      weightPct: 25,
    });
  });

  it('does not synthesize a strategy when the preview API is wired but the create API is absent', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview());

    render(<FactorModelBuilderPage api={{ previewFactorModel }} />);

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(1));
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();
  });

  it('requires an explicit strategy name before materialization', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview());
    const createFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>>()
      .mockResolvedValue({ strategy_id: 'strat_named' });

    render(<FactorModelBuilderPage api={{ previewFactorModel, createFactorModel }} />);

    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeEnabled());
    fireEvent.change(screen.getByLabelText('策略名称'), { target: { value: '   ' } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled());
    expect(screen.getByText('当前阻塞：策略名称未填写。')).toBeInTheDocument();
  });

  it('keeps industry neutralization optional and blocks only when enabled without PIT fields', async () => {
    const blockedPreview = makeReadyPreview({
      status: 'BLOCKED',
      neutralizationStatus: {
        enabled: true,
        method: 'industry',
        status: 'NOT_EXECUTED_MISSING_INDUSTRY_PIT',
        blockers: ['MISSING_INDUSTRY_PIT'],
      },
      warnings: ['行业中性化需要 PIT 行业字段，本次预览仅返回 blocker，不执行残差化。'],
    });
    const readyWithoutNeutralization = makeReadyPreview({
      neutralizationStatus: {
        enabled: false,
        method: 'industry',
        status: 'DISABLED',
        blockers: [],
      },
    });
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockImplementation(async (payload) =>
        payload.neutralization.enabled ? blockedPreview : readyWithoutNeutralization,
      );
    const createFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>>()
      .mockResolvedValue({ strategy_id: 'strat_multifactor_no_neutralization' });

    render(<FactorModelBuilderPage api={{ previewFactorModel, createFactorModel }} />);

    await waitFor(() => expect(previewFactorModel.mock.calls.at(-1)?.[0].neutralization.enabled).toBe(false));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeEnabled());

    fireEvent.click(screen.getByRole('button', { name: '启用行业中性化' }));

    expect(await screen.findByText('当前阻塞：行业 PIT 字段缺失。')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '关闭行业中性化' }));

    await waitFor(() => expect(previewFactorModel.mock.calls.at(-1)?.[0].neutralization.enabled).toBe(false));
    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeEnabled());
    fireEvent.click(screen.getAllByRole('button', { name: '创建可回测策略' })[0]);

    await waitFor(() => expect(createFactorModel).toHaveBeenCalledTimes(1));
    expect(createFactorModel.mock.calls[0][0].neutralization.enabled).toBe(false);
    expect(await screen.findByText('已创建 MULTI_FACTOR 策略：strat_multifactor_no_neutralization')).toBeInTheDocument();
  });

  it('ignores stale preview responses after neutralization is toggled', async () => {
    const blockedPreview = makeReadyPreview({
      status: 'BLOCKED',
      neutralizationStatus: {
        enabled: true,
        method: 'industry',
        status: 'NOT_EXECUTED_MISSING_INDUSTRY_PIT',
        blockers: ['MISSING_INDUSTRY_PIT'],
      },
      warnings: ['行业中性化需要 PIT 行业字段，本次预览仅返回 blocker，不执行残差化。'],
    });
    const readyWithoutNeutralization = makeReadyPreview({
      neutralizationStatus: {
        enabled: false,
        method: 'industry',
        status: 'DISABLED',
        blockers: [],
      },
    });
    const resolvers: Array<(preview: FactorModelPreview) => void> = [];
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));

    render(<FactorModelBuilderPage api={{ previewFactorModel }} />);

    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: '启用行业中性化' }));
    await waitFor(() => expect(previewFactorModel).toHaveBeenCalledTimes(2));

    resolvers[1](blockedPreview);
    expect(await screen.findByText('BLOCKED')).toBeInTheDocument();

    resolvers[0](readyWithoutNeutralization);
    await waitFor(() => expect(screen.getByText('BLOCKED')).toBeInTheDocument());
    expect(screen.getByText('当前阻塞：行业 PIT 字段缺失。')).toBeInTheDocument();
  });

  it('creates a MULTI_FACTOR strategy and leaves navigation as an integration hook', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview());
    const response: FactorModelCreateResponse = {
      strategy_id: 'strat_multifactor_001',
      parameter_version_id: 'pv_multifactor_001',
    };
    const createFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelCreateResponse>>()
      .mockResolvedValue(response);
    const onCreated = vi.fn<(strategyId: string) => void>();

    render(<FactorModelBuilderPage api={{ previewFactorModel, createFactorModel }} onCreated={onCreated} />);

    fireEvent.change(screen.getByLabelText('策略名称'), { target: { value: '真实 PIT 多因子策略' } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeEnabled());

    fireEvent.click(screen.getAllByRole('button', { name: '创建可回测策略' })[0]);

    await waitFor(() => expect(createFactorModel).toHaveBeenCalledTimes(1));
    expect(createFactorModel.mock.calls[0][0].modelName).toBe('真实 PIT 多因子策略');
    expect(createFactorModel.mock.calls[0][0].factors).toHaveLength(5);
    expect(createFactorModel.mock.calls[0][0].factors.reduce((sum, factor) => sum + factor.weightPct, 0)).toBe(100);
    expect(createFactorModel.mock.calls[0][0].neutralization.enabled).toBe(false);
    expect(onCreated).toHaveBeenCalledWith('strat_multifactor_001');
    expect(await screen.findByText('已创建 MULTI_FACTOR 策略：strat_multifactor_001')).toBeInTheDocument();
  });

  it('blocks materialization when the preview API reports missing industry PIT', async () => {
    const previewFactorModel = vi
      .fn<(payload: FactorModelPreviewPayload) => Promise<FactorModelPreview>>()
      .mockResolvedValue(makeReadyPreview({
        status: 'BLOCKED',
        neutralizationStatus: {
          enabled: true,
          method: 'industry',
          status: 'NOT_EXECUTED_MISSING_INDUSTRY_PIT',
          blockers: ['MISSING_INDUSTRY_PIT'],
        },
        warnings: ['行业中性化需要 PIT 行业字段，本次预览仅返回 blocker，不执行残差化。'],
      }));

    render(<FactorModelBuilderPage api={{ previewFactorModel }} />);

    const riskBox = await screen.findByText('当前阻塞：行业 PIT 字段缺失。');
    expect(riskBox.closest('.risk-box')).not.toBeNull();
    expect(screen.getAllByText('行业 PIT 字段缺失')[0]).toBeInTheDocument();
    expect(screen.getByText('BLOCKED')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();
  });

  it('keeps creation disabled until selected factor weights add up to 100%', () => {
    render(<FactorModelBuilderPage />);

    fireEvent.click(screen.getByLabelText('选择12-1月截面动量排名'));

    const weightRow = screen.getByText('权重合计').closest('.audit-row');
    expect(weightRow).not.toBeNull();
    expect(within(weightRow as HTMLElement).getByText('70%')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '创建可回测策略' })[0]).toBeDisabled();
  });

  it('keeps the model builder layout as a three-column workstation with stable responsive constraints', () => {
    const css = readFileSync('src/pages/factor-phase2-pages.css', 'utf8');

    expect(css).toMatch(/\.factor-model-builder-page\.factor-phase2-page\s*\{[^}]*width:\s*100%;/s);
    expect(css).toMatch(/\.factor-model-builder-page \.factor-phase2-workbench--model\s*\{[^}]*grid-template-columns:\s*minmax\(280px,\s*0\.85fr\)\s*minmax\(0,\s*1\.42fr\)\s*minmax\(320px,\s*0\.78fr\);/s);
    expect(css).toContain('.factor-model-builder-page .factor-pick');
    expect(css).toContain('.factor-model-builder-page .factor-model-name-control');
    expect(css).toContain('.factor-model-builder-page .factor-weight-control');
    expect(css).toContain('.factor-model-builder-page .neutral-block');
    expect(css).toContain('.factor-model-builder-page .switch--off');
    expect(css).toContain('.factor-model-builder-page .risk-box');
    expect(css).toContain('overflow-wrap: anywhere;');
    expect(css).toMatch(/@media\s*\(max-width:\s*720px\)[\s\S]*\.factor-phase2-metrics,[\s\S]*\.factor-model-factor\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  });
});

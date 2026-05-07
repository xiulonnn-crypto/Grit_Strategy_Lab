import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FactorSandboxPage, {
  type FactorMiningCandidate,
  type FactorMiningCreatePayload,
  type FactorMiningJob,
} from './pages/factor-sandbox-page';

afterEach(() => {
  cleanup();
});

describe('FactorSandboxPage', () => {
  const runtimeCandidate: FactorMiningCandidate = {
    id: 'cand_runtime_001',
    expression: 'Rank(Return(Close, 21))',
    family: '动量候选 #1',
    rankIc: 0.061,
    coveragePct: 75,
    turnoverPct: 0,
    riskFlags: ['价格 PIT 覆盖不足'],
  };

  const runtimeJob: FactorMiningJob = {
    id: 'fm_runtime_001',
    name: 'SP500 因子挖掘',
    status: 'COMPLETED',
    universe: 'SP500',
    dateRange: '2020-01-01 至 2025-12-31',
    operators: ['Return', 'Rank'],
    candidateCount: 120,
    startDate: '2020-01-01',
    endDate: '2025-12-31',
    progressPct: 100,
    throughputPerMinute: 60,
    failedSampleCount: 0,
    topRankIc: 0.061,
    createdAt: '2026-05-06T09:30:00Z',
    randomSeed: 42,
    minRankIc: 0.035,
    maxDepth: 4,
    topCandidates: [runtimeCandidate],
  };

  it('deduplicates repeated sandbox jobs and candidate expressions before rendering', () => {
    const repeatedCandidateJob: FactorMiningJob = {
      ...runtimeJob,
      id: 'fm_repeat_latest',
      candidateCount: 250,
      operators: ['Return', 'Rank', 'ZScore'],
      topCandidates: [
        { ...runtimeCandidate, id: 'cand_repeat_a', expression: 'Return(Close, 5)', family: '动量候选 #1' },
        { ...runtimeCandidate, id: 'cand_repeat_b', expression: 'Return(Close, 5)', family: '动量候选 #2' },
        { ...runtimeCandidate, id: 'cand_repeat_c', expression: 'Return(Close, 5)', family: '动量候选 #3' },
      ],
    };

    render(
      <FactorSandboxPage
        initialJobs={[
          repeatedCandidateJob,
          {
            ...repeatedCandidateJob,
            id: 'fm_repeat_older',
            createdAt: '2026-05-06T08:00:00Z',
          },
        ]}
      />,
    );

    expect(screen.getAllByRole('heading', { level: 3, name: 'SP500 因子挖掘' })).toHaveLength(1);
    expect(screen.getAllByText('Return(Close, 5)')).toHaveLength(1);
    expect(screen.getByText('1 个任务')).toBeInTheDocument();
  });

  it('validates duplicate sandbox job configuration before submitting the create request', () => {
    const createFactorMiningJob = vi.fn<(payload: FactorMiningCreatePayload) => Promise<FactorMiningJob>>();

    render(
      <FactorSandboxPage
        api={{ createFactorMiningJob }}
        initialJobs={[
          {
            ...runtimeJob,
            candidateCount: 250,
            operators: ['Return', 'Rank', 'ZScore'],
          },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '创建挖掘任务' }));

    expect(createFactorMiningJob).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('已存在相同任务配置');
  });

  it('keeps sandbox job and candidate lists scrollable after the first three rows', () => {
    const jobs = Array.from({ length: 4 }, (_item, index): FactorMiningJob => ({
      ...runtimeJob,
      id: `fm_unique_${index + 1}`,
      dateRange: `202${index}-01-01 至 2025-12-31`,
      startDate: `202${index}-01-01`,
      endDate: '2025-12-31',
      topCandidates: [
        {
          ...runtimeCandidate,
          id: `cand_unique_${index + 1}`,
          expression: `Return(Close, ${index + 3})`,
          family: `动量候选 #${index + 1}`,
        },
      ],
    }));

    render(<FactorSandboxPage initialJobs={jobs} />);

    const jobList = screen.getByLabelText('任务队列列表');
    const candidateList = screen.getByLabelText('候选摘要列表');
    expect(jobList).toHaveClass('factor-phase2-list--scroll');
    expect(candidateList).toHaveClass('factor-phase2-list--scroll');
    expect(within(jobList).getAllByRole('listitem')).toHaveLength(4);
    expect(within(candidateList).getAllByRole('listitem')).toHaveLength(4);
  });

  it('renders the V1.7 sandbox shell without local sample jobs or candidates', () => {
    render(<FactorSandboxPage />);

    expect(document.querySelector('[data-page-root="factor-sandbox"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '挖掘沙盒' })).toBeInTheDocument();
    expect(screen.getByText('运行进度')).toBeInTheDocument();
    expect(screen.getAllByText('吞吐').length).toBeGreaterThan(0);
    expect(screen.getAllByText('失败样本').length).toBeGreaterThan(0);
    expect(screen.getByText('最高 IC')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '任务队列' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '候选摘要' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '创建任务' })).toBeInTheDocument();
    expect(screen.getByLabelText('样本池')).toBeInTheDocument();
    expect(screen.getByLabelText('开始日期')).toBeInTheDocument();
    expect(screen.getByLabelText('结束日期')).toBeInTheDocument();
    expect(screen.getByLabelText('候选数量')).toBeInTheDocument();
    expect(screen.getByLabelText('随机种子')).toBeInTheDocument();
    expect(screen.getByLabelText('IC 门槛')).toBeInTheDocument();
    expect(screen.getByText(/候选不会直接写入正式因子库/)).toBeInTheDocument();
    expect(screen.getByText(/缺少 `available_at` 的基础面字段/)).toBeInTheDocument();
    expect(screen.queryByText('US Core 1500 · 估值质量混合')).not.toBeInTheDocument();
    expect(screen.queryByText('ZScore(Winsorize(LtmEarnings / MarketCap))')).not.toBeInTheDocument();
    expect(screen.getByText('暂无挖掘任务')).toBeInTheDocument();
    expect(screen.getByText('暂无候选摘要')).toBeInTheDocument();
  });

  it('loads the job queue and top candidates through the runtime list API', async () => {
    const listFactorMiningJobs = vi.fn<() => Promise<FactorMiningJob[]>>().mockResolvedValue([runtimeJob]);

    render(<FactorSandboxPage api={{ listFactorMiningJobs }} />);

    expect(screen.getByText('正在读取挖掘任务')).toBeInTheDocument();

    await waitFor(() => expect(listFactorMiningJobs).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('SP500 因子挖掘')).toBeInTheDocument();
    expect(screen.getByText('Rank(Return(Close, 21))')).toBeInTheDocument();
    expect(screen.getByText('价格 PIT 覆盖不足')).toBeInTheDocument();
    expect(screen.queryByText('mine_20260505_001')).not.toBeInTheDocument();
  });

  it('sends a sandbox candidate into the quarantine intake API without creating a factor', async () => {
    const intakeFactorQuarantine = vi
      .fn<(payload: { miningJobId?: string; candidateIds?: string[] }) => Promise<{ intakeCount: number }>>()
      .mockResolvedValue({ intakeCount: 1 });

    render(
      <FactorSandboxPage
        api={{ intakeFactorQuarantine }}
        initialJobs={[runtimeJob]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '送入检疫' }));

    await waitFor(() => expect(intakeFactorQuarantine).toHaveBeenCalledWith({
      miningJobId: 'fm_runtime_001',
      candidateIds: ['cand_runtime_001'],
    }));
    expect(await screen.findByText('已送入检疫工作台：Rank(Return(Close, 21))')).toBeInTheDocument();
  });

  it('creates a mining job through the injected API without requiring route or global client wiring', async () => {
    const createdJob: FactorMiningJob = {
      id: 'mine_test_001',
      name: 'SP500 · 自动挖掘',
      status: 'QUEUED',
      universe: 'SP500',
      dateRange: '2020-01-01 至 2025-12-31',
      operators: ['Return', 'Rank', 'ZScore'],
      candidateCount: 1000,
      progressPct: 0,
      throughputPerMinute: 0,
      failedSampleCount: 0,
      topRankIc: 0,
      createdAt: '刚刚',
      topCandidates: [],
    };
    const createFactorMiningJob = vi
      .fn<(payload: FactorMiningCreatePayload) => Promise<FactorMiningJob>>()
      .mockResolvedValue(createdJob);

    render(<FactorSandboxPage api={{ createFactorMiningJob }} />);

    fireEvent.change(screen.getByLabelText('候选数量'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: '创建挖掘任务' }));

    await waitFor(() => expect(createFactorMiningJob).toHaveBeenCalledTimes(1));
    expect(createFactorMiningJob.mock.calls[0][0]).toMatchObject({
      universe: 'SP500',
      candidateCount: 1000,
      randomSeed: 42,
      minRankIc: 0.035,
      maxDepth: 4,
    });
    expect(await screen.findByText('任务已进入运行队列：SP500 · 自动挖掘')).toBeInTheDocument();
  });

  it('prevents duplicate mining submissions while the API request is in flight', async () => {
    const createdJob: FactorMiningJob = {
      id: 'mine_running_001',
      name: 'SP500 · 自动挖掘',
      status: 'RUNNING',
      universe: 'SP500',
      dateRange: '2020-01-01 至 2025-12-31',
      operators: ['Return', 'Rank', 'ZScore'],
      candidateCount: 250,
      progressPct: 0,
      throughputPerMinute: 0,
      failedSampleCount: 0,
      topRankIc: 0,
      createdAt: '刚刚',
      topCandidates: [],
    };
    let resolveJob: (job: FactorMiningJob) => void = () => {};
    const createFactorMiningJob = vi
      .fn<(payload: FactorMiningCreatePayload) => Promise<FactorMiningJob>>()
      .mockImplementation(() => new Promise((resolve) => {
        resolveJob = resolve;
      }));

    render(<FactorSandboxPage api={{ createFactorMiningJob }} />);

    const submitButton = screen.getByRole('button', { name: '创建挖掘任务' });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);

    expect(createFactorMiningJob).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: '创建中...' })[0]).toBeDisabled();
    });
    expect(screen.getByRole('status')).toHaveTextContent('正在创建挖掘任务，请勿重复提交。');

    await act(async () => {
      resolveJob(createdJob);
    });

    expect(await screen.findByText('任务已进入运行队列：SP500 · 自动挖掘')).toBeInTheDocument();
  });

  it('keeps cancellation scoped to sandbox jobs and renders the cancelled state', async () => {
    const cancelFactorMiningJob = vi.fn<(jobId: string) => Promise<FactorMiningJob>>().mockResolvedValue({
      id: 'mine_running',
      name: 'US Core 1500 · 测试任务',
      status: 'CANCELLED',
      universe: 'US Core 1500',
      dateRange: '2016-01-01 至 2025-12-31',
      operators: ['Rank'],
      candidateCount: 1000,
      progressPct: 44,
      throughputPerMinute: 100,
      failedSampleCount: 3,
      topRankIc: 0.05,
      createdAt: '刚刚',
      topCandidates: [],
    });

    render(
      <FactorSandboxPage
        api={{ cancelFactorMiningJob }}
        initialCandidates={[]}
        initialJobs={[
          {
            id: 'mine_running',
            name: 'US Core 1500 · 测试任务',
            status: 'RUNNING',
            universe: 'US Core 1500',
            dateRange: '2016-01-01 至 2025-12-31',
            operators: ['Rank'],
            candidateCount: 1000,
            progressPct: 44,
            throughputPerMinute: 100,
            failedSampleCount: 3,
            topRankIc: 0.05,
            createdAt: '刚刚',
            topCandidates: [],
          },
        ]}
      />,
    );

    const jobRow = screen.getByText('US Core 1500 · 测试任务').closest('.factor-phase2-row');
    expect(jobRow).not.toBeNull();
    fireEvent.click(within(jobRow as HTMLElement).getByRole('button', { name: '取消' }));

    await waitFor(() => expect(cancelFactorMiningJob).toHaveBeenCalledWith('mine_running'));
    expect(await screen.findByText('已取消')).toBeInTheDocument();
  });

  it('keeps the approved sandbox layout as a wide three-column workstation with a mobile single-column fallback', () => {
    const css = readFileSync('src/pages/factor-phase2-pages.css', 'utf8');

    expect(css).toContain('max-width: 1960px;');
    expect(css).toMatch(/\.factor-phase2-hero\s*\{[^}]*max-width:\s*1960px;/s);
    expect(css).toMatch(/\.factor-phase2-hero\s*\{[^}]*margin:\s*0;/s);
    expect(css).toMatch(/\.factor-phase2-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.1fr\)\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*0\.78fr\);/s);
    expect(css).toMatch(/\.factor-sandbox-page\s+\.factor-phase2-list--scroll\s*\{[^}]*max-height:\s*calc\([^}]*overflow-y:\s*auto;/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*1180px\)\s*\{[^}]*\.factor-phase2-hero,[^}]*\.factor-phase2-workbench,[^}]*\.factor-quarantine-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  });
});

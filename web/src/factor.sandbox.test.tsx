import { readFileSync } from 'node:fs';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FactorSandboxPage, {
  type FactorMiningCreatePayload,
  type FactorMiningJob,
} from './pages/factor-sandbox-page';

afterEach(() => {
  cleanup();
});

describe('FactorSandboxPage', () => {
  it('renders the V1.7 sandbox hero, metrics, queue, candidates, create form, and risk notice', () => {
    render(<FactorSandboxPage />);

    expect(document.querySelector('[data-page-root="factor-sandbox"]')).not.toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: '挖掘沙盒' })).toBeInTheDocument();
    expect(screen.getByText('运行进度')).toBeInTheDocument();
    expect(screen.getAllByText('吞吐').length).toBeGreaterThan(0);
    expect(screen.getAllByText('失败样本').length).toBeGreaterThan(0);
    expect(screen.getByText('Top IC')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '任务队列' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Top candidates' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '创建任务' })).toBeInTheDocument();
    expect(screen.getByLabelText('Universe')).toBeInTheDocument();
    expect(screen.getByLabelText('开始日期')).toBeInTheDocument();
    expect(screen.getByLabelText('结束日期')).toBeInTheDocument();
    expect(screen.getByLabelText('候选数量')).toBeInTheDocument();
    expect(screen.getByLabelText('随机种子')).toBeInTheDocument();
    expect(screen.getByLabelText('IC 门槛')).toBeInTheDocument();
    expect(screen.getByText(/候选不会直接写入正式因子库/)).toBeInTheDocument();
    expect(screen.getByText(/缺少 `available_at` 的基础面字段/)).toBeInTheDocument();
  });

  it('creates a mining job through the injected API without requiring route or global client wiring', async () => {
    const createdJob: FactorMiningJob = {
      id: 'mine_test_001',
      name: 'S&P 500 PIT · 自动挖掘',
      status: 'QUEUED',
      universe: 'S&P 500 PIT',
      dateRange: '2016-01-01 至 2025-12-31',
      operators: ['Rank', 'ZScore', 'Winsorize'],
      candidateCount: 1000,
      progressPct: 0,
      throughputPerMinute: 0,
      failedSampleCount: 0,
      topRankIc: 0,
      createdAt: '刚刚',
    };
    const createFactorMiningJob = vi
      .fn<(payload: FactorMiningCreatePayload) => Promise<FactorMiningJob>>()
      .mockResolvedValue(createdJob);

    render(<FactorSandboxPage api={{ createFactorMiningJob }} />);

    fireEvent.change(screen.getByLabelText('Universe'), { target: { value: 'S&P 500 PIT' } });
    fireEvent.change(screen.getByLabelText('候选数量'), { target: { value: '1000' } });
    fireEvent.click(screen.getByRole('button', { name: '创建挖掘任务' }));

    await waitFor(() => expect(createFactorMiningJob).toHaveBeenCalledTimes(1));
    expect(createFactorMiningJob.mock.calls[0][0]).toMatchObject({
      universe: 'S&P 500 PIT',
      candidateCount: 1000,
      randomSeed: 42,
      minRankIc: 0.035,
      maxDepth: 4,
    });
    expect(await screen.findByText('已创建挖掘任务：S&P 500 PIT · 自动挖掘')).toBeInTheDocument();
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

    expect(css).toContain('max-width: 1660px;');
    expect(css).toMatch(/\.factor-phase2-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1\.1fr\)\s*minmax\(0,\s*1fr\)\s*minmax\(320px,\s*0\.78fr\);/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*1180px\)\s*\{[^}]*\.factor-phase2-hero,\s*\n\s*\.factor-phase2-workbench\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  });
});

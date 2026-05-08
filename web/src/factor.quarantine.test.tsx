import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from './lib/demoStoreContext';
import FactorQuarantinePage from './pages/factor-quarantine-page';
import type { ApiFactorQuarantineCandidate } from './types';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const pendingCandidate: ApiFactorQuarantineCandidate = {
  id: 'fq_runtime_001',
  mining_candidate_id: 'cand_runtime_001',
  source_mining_job_id: 'fm_runtime_001',
  expression: 'Rank(Return(Close, 21))',
  status: 'PENDING',
  publish_status: 'BLOCKED',
  gate_summary: { pit: 'READY' },
  cluster_id: 'cluster_runtime_mom',
  candidate_metrics: { rank_ic: 0.061, coverage: 100, turnover: 0 },
  failure_samples: [],
  pit_evidence: { status: 'READY', dataset_snapshot_id: 'ds-price' },
  publish_eligibility: { status: 'BLOCKED', reason: '已从沙盒进入检疫队列，等待运行 D2 门禁。' },
  target_factor_id: null,
  created_at: '2026-05-07T08:00:00Z',
  updated_at: '2026-05-07T08:00:00Z',
};

const passedCandidate: ApiFactorQuarantineCandidate = {
  ...pendingCandidate,
  status: 'PASSED',
  publish_status: 'ELIGIBLE',
  gate_summary: {
    pit: 'Full Ready',
    is_rank_ic: 0.061,
    oos_rank_ic: 0.04,
    max_abs_correlation: 0.18,
  },
  publish_eligibility: { status: 'ELIGIBLE', reason: '通过 D2 检疫，允许自动发布。' },
};

const publishedCandidate: ApiFactorQuarantineCandidate = {
  ...passedCandidate,
  status: 'PUBLISHED',
  publish_status: 'PUBLISHED',
  target_factor_id: 'auto_runtime_mom_001',
  published_at: '2026-05-07T08:05:00Z',
};

function renderPage(): void {
  render(
    <ApiClientProvider>
      <FactorQuarantinePage />
    </ApiClientProvider>,
  );
}

describe('FactorQuarantinePage', () => {
  it('does not render fallback candidates when the runtime queue is empty', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ items: [], summary: { total: 0 } }),
    );

    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: '检疫工作台' })).toBeInTheDocument();
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/factor-quarantine/candidates'),
      expect.any(Object),
    ));
    expect(screen.getByText('暂无检疫候选。请先从挖掘沙盒接收候选表达式。')).toBeInTheDocument();
    expect(screen.queryByText('Rank(Close(t-21) / Close(t-252) - 1)')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布通过项' })).toBeDisabled();
  });

  it('keeps the first render alive when legacy runtime rows have null report fields', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        items: [{
          id: 'fq_legacy_null_report',
          expression: 'Residual(s_mom_6m_rank, s_vol_252d_raw)',
          status: 'NEEDS_REVIEW',
          publish_status: 'MANUAL_REVIEW_REQUIRED',
          gate_summary: null,
          candidate_metrics: null,
          failure_samples: null,
          pit_evidence: null,
          publish_eligibility: null,
          created_at: '2026-05-08T08:00:00Z',
          updated_at: '2026-05-08T08:00:00Z',
        }],
        summary: { total: 1 },
      }),
    );

    renderPage();

    expect(await screen.findByText('Residual(s_mom_6m_rank, s_vol_252d_raw)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '检疫报告' })).toBeInTheDocument();
    expect(screen.getAllByText('待生成').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText('检疫报告已保留门禁摘要、正交化说明和结果附件引用。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布通过项' })).toBeDisabled();
  });

  it('intakes, batch-runs, and publishes real quarantine candidates through the API', async () => {
    let queue: ApiFactorQuarantineCandidate[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === 'POST' && url.pathname === '/factor-quarantine/intake') {
        queue = [pendingCandidate];
        return jsonResponse({
          items: queue,
          summary: {
            intake_count: 1,
            source_mining_job_id: 'fm_runtime_001',
            sandbox_candidates_persisted_to_factor_definitions: false,
          },
        });
      }
      if (init?.method === 'POST' && url.pathname === '/factor-quarantine/candidates/fq_runtime_001/run') {
        queue = [passedCandidate];
        return jsonResponse(passedCandidate);
      }
      if (init?.method === 'POST' && url.pathname === '/factor-quarantine/candidates/fq_runtime_001/publish') {
        queue = [publishedCandidate];
        return jsonResponse({ candidate: publishedCandidate });
      }
      if (url.pathname === '/factor-quarantine/candidates') {
        return jsonResponse({ items: queue, summary: { total: queue.length } });
      }
      return jsonResponse({ message: `unexpected ${url.pathname}` }, 404);
    });

    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: '从沙盒拉入' }));
    expect(await screen.findByText('Rank(Return(Close, 21))')).toBeInTheDocument();
    expect(screen.getByText('已从挖掘沙盒接收 1 条候选。')).toBeInTheDocument();
    expect(screen.getByText('待检疫')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '一键检疫' }));
    expect(await screen.findByText('已完成一键检疫 1 条：通过 1、待复核 0、拒绝 0。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发布通过项' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '发布通过项' }));
    expect(await screen.findByText('已发布 1 条通过项，并保留发布审计。')).toBeInTheDocument();
    expect(screen.getByText('auto_runtime_mom_001')).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/factor-quarantine/candidates/fq_runtime_001/publish'),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('dedupes repeated expressions returned by the runtime API', async () => {
    const duplicateCandidate: ApiFactorQuarantineCandidate = {
      ...pendingCandidate,
      id: 'fq_runtime_duplicate',
      mining_candidate_id: 'cand_runtime_duplicate',
      source_mining_job_id: 'fm_runtime_older',
      updated_at: '2026-05-07T07:00:00Z',
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({ items: [pendingCandidate, duplicateCandidate], summary: { total: 2 } }),
    );

    renderPage();

    expect(await screen.findByText('Rank(Return(Close, 21))')).toBeInTheDocument();
    expect(screen.getAllByText('Rank(Return(Close, 21))')).toHaveLength(1);
  });
});

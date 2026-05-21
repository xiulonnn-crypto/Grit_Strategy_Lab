import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClientProvider } from './lib/demoStoreContext';
import { FactorLibraryPage } from './pages/factors-page';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = '';
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function f1CatalogPayload() {
  return {
    snapshot: {
      id: 'f1_catalog_snapshot_20260519_001',
      snapshot_id: 'f1_catalog_snapshot_20260519_001',
      run_id: 'pit_pre_20260519_001',
      as_of_date: '2026-05-19',
      generated_at: '2026-05-19T08:00:00Z',
      field_count: 3,
      callable_count: 2,
      blocked_count: 1,
      timing_gap_count: 0,
      summary: { ic_ir_gate: 'NOT_APPLIED' },
    },
    summary: {
      item_count: 3,
      callable_count: 2,
      blocked_count: 1,
      timing_gap_count: 0,
      ic_ir_gate: 'NOT_APPLIED',
      admission_policy: 'PIT_COVERAGE_TIMING_BLOCKER_ONLY',
    },
    items: [
      {
        factor_id: 'f1_price_close',
        name: '收盘价',
        category: '价格',
        pit_layer: 'L1',
        source_refs: { dataset_snapshot_id: 'ds-price', source: 'runtime_price' },
        coverage_ratio: 0.92,
        available_symbol_count: 92,
        total_symbol_count: 100,
        missing_symbols: ['MSFT'],
        missing_symbol_count: 1,
        publish_date_rule: '交易日收盘价',
        available_at_rule: 'T 日收盘后',
        missing_policy: '缺失 L1 输出 NaN，不填 0。',
        blocker_code: 'DATA_SOURCE_BLOCKED',
        admission_state: 'DATA_SOURCE_BLOCKED',
        future_leakage_risk: 'REVIEW_REQUIRED',
        last_updated_at: '2026-05-19T08:00:00Z',
        metadata: {},
      },
      {
        factor_id: 'f1_return_1d_base',
        name: '基础收益率',
        category: '收益率基础',
        pit_layer: 'L1',
        source_refs: { dataset_snapshot_id: 'ds-price', source: 'runtime_price' },
        coverage_ratio: 1,
        available_symbol_count: 100,
        total_symbol_count: 100,
        missing_symbols: [],
        missing_symbol_count: 0,
        publish_date_rule: '交易日收盘价派生',
        available_at_rule: 'T 日收盘后',
        missing_policy: '历史不足输出 NaN。',
        blocker_code: null,
        admission_state: 'READY',
        future_leakage_risk: 'LOW',
        last_updated_at: '2026-05-19T08:00:00Z',
        metadata: {},
      },
      {
        factor_id: 'f1_short_balance',
        name: '卖空余额',
        category: '卖空',
        pit_layer: 'L3',
        source_refs: { dataset_snapshot_id: 'ds-short', source: 'short_interest' },
        coverage_ratio: 1,
        available_symbol_count: 100,
        total_symbol_count: 100,
        missing_symbols: [],
        missing_symbol_count: 0,
        publish_date_rule: '交易所披露日',
        available_at_rule: '披露后可得',
        missing_policy: '来源待复核。',
        blocker_code: null,
        admission_state: 'READY_WITH_WARNING',
        future_leakage_risk: 'REVIEW_REQUIRED',
        last_updated_at: '2026-05-19T08:00:00Z',
        metadata: {},
      },
    ],
  };
}

describe('FactorLibraryPage Phase 0 F1 catalog', () => {
  it('uses factor admission status for the library hero instead of overall PIT status', async () => {
    window.location.hash = '#/factors';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/factors') {
        return jsonResponse({
          items: [],
          summary: {
            total: 0,
            pit_status: 'BLOCKED',
            factor_admission_status: 'READY',
            factor_admission_blocks: false,
          },
        });
      }
      if (url.pathname === '/factor-governance/overview') {
        return jsonResponse({ as_of: '2026-05-21T00:00:00Z', queue_count: 0, actions: [] });
      }
      return jsonResponse({});
    });

    render(
      <ApiClientProvider>
        <FactorLibraryPage />
      </ApiClientProvider>,
    );

    expect(await screen.findByText('PIT 准入：正式诊断可用')).toBeInTheDocument();
    expect(screen.queryByText('PIT 准入：阻塞')).not.toBeInTheDocument();
  });

  it('renders the dedicated F1 raw catalog tab with PIT-only admission copy and table columns', async () => {
    window.location.hash = '#/factors?layer=F1';
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === '/factors/f1-catalog') return jsonResponse(f1CatalogPayload());
      if (url.pathname === '/factors/f1-catalog/latest') return jsonResponse(f1CatalogPayload());
      if (url.pathname === '/factors') return jsonResponse({ items: [], summary: { total: 0 } });
      if (url.pathname === '/pit-data/overview') return jsonResponse({ status: 'READY' });
      return jsonResponse({});
    });

    render(
      <ApiClientProvider>
        <FactorLibraryPage />
      </ApiClientProvider>,
    );

    const panel = await screen.findByTestId('f1-raw-catalog');
    expect(screen.getByText('按 F1/F2/F3 管理因子资产。F1 只校验 PIT、覆盖率、可得时点与数据阻塞。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /F1 原始库/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('PIT 原始字段，按时点与覆盖准入')).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'F1 原始字段目录' })).toBeInTheDocument();
    expect(within(panel).getByText('最新批次')).toBeInTheDocument();
    expect(within(panel).getByText('数据源签名')).toBeInTheDocument();
    expect(within(panel).getByText(/不设 IC 门槛/)).toBeInTheDocument();
    expect(within(panel).getByText('缺失 L1 输出 NaN')).toBeInTheDocument();
    expect(within(panel).getByRole('columnheader', { name: '字段' })).toBeInTheDocument();
    expect(within(panel).getByRole('columnheader', { name: '层级' })).toBeInTheDocument();
    expect(within(panel).getByRole('columnheader', { name: '覆盖' })).toBeInTheDocument();
    expect(within(panel).getByRole('columnheader', { name: '时点' })).toBeInTheDocument();
    expect(within(panel).getByRole('columnheader', { name: '阻塞' })).toBeInTheDocument();
    expect(within(panel).getByText('源阻塞')).toBeInTheDocument();
    expect(within(panel).getByText('缺 1 个标的，暂不可调用')).toBeInTheDocument();
    expect(within(panel).getByText('无阻塞')).toBeInTheDocument();
    expect(within(panel).getByText('覆盖完整，可调用')).toBeInTheDocument();
    expect(within(panel).getByText('需复核')).toBeInTheDocument();
    expect(within(panel).getByText('审慎可调用，来源/时点待确认')).toBeInTheDocument();
    expect(within(panel).getByText('审慎可调用')).toBeInTheDocument();
    expect(within(panel).queryByText('DATA_SOURCE_BLOCKED')).not.toBeInTheDocument();
    expect(within(panel).queryByText(/不填 0/)).not.toBeInTheDocument();
    expect(screen.queryByText('正交性热力图')).not.toBeInTheDocument();
    expect(screen.queryByText('因子资产台账')).not.toBeInTheDocument();
    expect(screen.queryByText('全部因子族')).not.toBeInTheDocument();
    expect(screen.queryByText('全部因子级别')).not.toBeInTheDocument();
    expect(screen.queryByText('待校准/归档')).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('tab', { name: /可调用/ }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining('status=READY'), expect.any(Object)));
  });

  it('keeps the F1 table responsive without forcing page-level horizontal scroll', () => {
    const css = readFileSync('src/pages/factors-page.css', 'utf8');

    expect(css).toMatch(/\.f1-raw-table-wrap\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s);
    expect(css).toMatch(/\.f1-raw-table\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*table-layout:\s*fixed;/s);
    expect(css).toMatch(/\.f1-raw-table td\s*\{[^}]*overflow-wrap:\s*anywhere;[^}]*word-break:\s*break-word;/s);
    expect(css).toMatch(/@media \(max-width:\s*960px\)[\s\S]*\.f1-raw-table thead\s*\{[^}]*display:\s*none;/);
    expect(css).toMatch(/\.f1-raw-table td:nth-child\(5\)::before\s*\{\s*content:\s*'阻塞';\s*\}/);
  });
});

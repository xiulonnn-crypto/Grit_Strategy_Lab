import { vi } from 'vitest';
import { demoApi, resetDemoStore, setPromoteConflict } from './lib/demoStorePhase4';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(error: unknown): Response {
  if (error instanceof Error) {
    const payload = {
      status: (error as Error & { status?: number }).status ?? 500,
      code: (error as Error & { code?: string }).code ?? 'error',
      message: error.message,
      blocking_code: (error as Error & { blocking_code?: string }).blocking_code,
      blocking_target: (error as Error & { blocking_target?: string }).blocking_target,
      next_action: (error as Error & { next_action?: string }).next_action,
    };
    return json(payload, payload.status);
  }
  return json({ status: 500, code: 'error', message: '发生了意外错误。' }, 500);
}

function readIdempotencyKey(request: Request, body: Record<string, unknown> | undefined): string {
  return request.headers.get('Idempotency-Key') ?? (typeof body?.idempotency_key === 'string' ? body.idempotency_key : '') ?? '';
}

function withoutAbortSignal(init?: RequestInit): RequestInit | undefined {
  if (!init) {
    return undefined;
  }
  const { signal: _signal, ...rest } = init;
  return rest;
}

export function installMockApiServer() {
  resetDemoStore();
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const baseUrl = 'http://localhost';
    const request =
      input instanceof Request
        ? new Request(new URL(input.url, baseUrl).toString(), input)
        : new Request(new URL(String(input), baseUrl).toString(), withoutAbortSignal(init));
    const url = new URL(request.url, 'http://localhost');
    const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
    const method = request.method.toUpperCase();
    const body = method === 'GET' || method === 'HEAD' ? undefined : ((await request.clone().json().catch(() => undefined)) as Record<string, unknown> | undefined);

    try {
      if (method === 'GET' && url.pathname === '/workspace/overview') {
        const includeCleanupAudit = ['1', 'true'].includes(
          (url.searchParams.get('include_cleanup_audit') ?? '').toLowerCase(),
        );
        return json(await demoApi.getWorkspaceOverview(includeCleanupAudit));
      }
      if (method === 'GET' && url.pathname === '/strategies') return json(await demoApi.listStrategies());
      if (method === 'GET' && segments[0] === 'strategies' && segments[2] === 'detail') return json(await demoApi.getStrategyDetail(segments[1]));
      if (method === 'POST' && segments[0] === 'strategies' && segments[2] === 'parameter-versions' && segments[4] === 'restore') {
        if (!demoApi.restoreStrategyParameterVersion) {
          return new Response(JSON.stringify({ message: 'restoreStrategyParameterVersion is not implemented' }), { status: 501 });
        }
        return json(
          await demoApi.restoreStrategyParameterVersion(
            segments[1],
            segments[3],
            body as import('./types').ParameterVersionRestorePayload,
          ),
        );
      }
      if (method === 'POST' && url.pathname === '/strategy-creation-sessions') {
        return json(
          await demoApi.createCreationSession(
            body as import('./types').CreateCreationSessionPayload | undefined,
          ),
        );
      }
      if (method === 'GET' && segments[0] === 'strategy-creation-sessions' && segments.length === 2) return json(await demoApi.getCreationSession(segments[1]));
      if (method === 'POST' && segments[0] === 'strategy-creation-sessions' && segments[2] === 'messages') {
        return json(await demoApi.appendCreationMessage(segments[1], String(body?.content ?? ''), typeof body?.revision === 'number' ? body.revision : undefined));
      }
      if (method === 'POST' && segments[0] === 'strategy-creation-sessions' && segments[2] === 'prepare-confirmation') return json(await demoApi.prepareConfirmation(segments[1]));
      if (method === 'PATCH' && segments[0] === 'strategy-creation-sessions' && segments[2] === 'confirmation') {
        return json(await demoApi.updateConfirmation(segments[1], {
          revision: Number(body?.revision ?? 1),
          strategy_type:
            typeof body?.strategy_type === 'string'
              ? (body.strategy_type as import('./types').StrategyType)
              : undefined,
          core: (body?.core as Record<string, string | number | boolean> | undefined) ?? {},
          logic: (body?.logic as Record<string, string | number | boolean> | undefined) ?? {},
          parameters: (body?.parameters as Record<string, string | number | boolean> | undefined) ?? {},
        }));
      }
      if (method === 'POST' && segments[0] === 'strategy-creation-sessions' && segments[2] === 'materialize') {
        return json(await demoApi.materializeStrategy(segments[1], readIdempotencyKey(request, body), Number(body?.confirmed_revision ?? 1)));
      }
      if (method === 'GET' && url.pathname === '/backtest-runs') {
        const query = {} as NonNullable<Parameters<typeof demoApi.listBacktestRuns>[0]>;
        const limitValue = url.searchParams.get('limit');
        if (limitValue !== null) {
          const parsedLimit = Number(limitValue);
          if (Number.isFinite(parsedLimit)) {
            query.limit = parsedLimit;
          }
        }
        const statusValue = url.searchParams.get('status');
        if (statusValue && ['QUEUED', 'RUNNING', 'COMPLETED', 'COMPLETED_WITH_WARNINGS', 'FAILED'].includes(statusValue)) {
          query.status = statusValue as NonNullable<Parameters<typeof demoApi.listBacktestRuns>[0]>['status'];
        }
        return json(await demoApi.listBacktestRuns(query));
      }
      if (method === 'GET' && segments[0] === 'backtest-runs' && segments[2] === 'detail') return json(await demoApi.getBacktestRunDetail(segments[1]));
      if (method === 'GET' && segments[0] === 'backtest-runs' && segments[2] === 'trades' && segments.length === 3) {
        const detail = await demoApi.getBacktestRunDetail(segments[1]);
        const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
        const pageSize = Math.max(1, Number(url.searchParams.get('page_size') ?? '50'));
        const segment = (url.searchParams.get('segment') ?? 'all').toLowerCase();
        const oosStartDate = detail.configuration?.oos_start_date;
        const tradeRows = (detail.trade_details ?? []).map((trade) => ({
          trade_time: trade.trade_date,
          symbol: trade.symbol,
          signal_date: trade.trade_date,
          signal_time: trade.trade_date,
          fill_date: trade.trade_date,
          fill_time: trade.trade_date,
          side: trade.side,
          direction_semantic: trade.side === 'BUY' ? 'OPEN' : 'CLOSE',
          quantity: trade.quantity,
          price: trade.price,
          fill_price_raw: trade.price,
          fill_price_adj: trade.price,
          fee_paid: 0,
          net_amount: trade.side === 'BUY' ? -trade.notional : trade.notional,
          pnl_contribution: trade.pnl_pct !== undefined ? Number(((trade.notional * trade.pnl_pct) / 100).toFixed(2)) : undefined,
          reason: trade.signal ?? trade.note ?? '交易记录',
          segment: oosStartDate && trade.trade_date >= oosStartDate ? 'OOS' : 'IS',
          adjustment_factor_t1: 1,
          split_ratio_t1: 1,
        })).filter((trade) => segment === 'all' || trade.segment.toLowerCase() === segment);
        const start = (page - 1) * pageSize;
        const items = tradeRows.slice(start, start + pageSize);
        return json({
          items,
          page,
          page_size: pageSize,
          total: tradeRows.length,
          total_pages: Math.max(1, Math.ceil(tradeRows.length / pageSize)),
        });
      }
      if (method === 'GET' && segments[0] === 'backtest-runs' && segments[2] === 'trades' && segments[4] === 'audit') {
        return json(await demoApi.getBacktestTradeAudit(segments[1], segments[3]));
      }
      if (method === 'POST' && segments[0] === 'backtest-runs' && segments[2] === 'save') {
        return json(await demoApi.saveBacktestRun(segments[1]));
      }
      if (method === 'DELETE' && segments[0] === 'backtest-runs' && segments.length === 2) {
        return json(await demoApi.deleteBacktestRun(segments[1]));
      }
      if (method === 'POST' && segments[0] === 'strategies' && segments[2] === 'backtest-runs' && segments[3] === 'preview') {
        return json(await demoApi.previewBacktestRun(segments[1], {
          start_date: typeof body?.start_date === 'string' ? body.start_date : undefined,
          end_date: typeof body?.end_date === 'string' ? body.end_date : undefined,
          parameter_version_id: typeof body?.parameter_version_id === 'string' ? body.parameter_version_id : undefined,
          dataset_snapshot_id: typeof body?.dataset_snapshot_id === 'string' ? body.dataset_snapshot_id : undefined,
          universe_snapshot_id: typeof body?.universe_snapshot_id === 'string' ? body.universe_snapshot_id : undefined,
          execution_policy: typeof body?.execution_policy === 'string' ? body.execution_policy : undefined,
          fee_bps: typeof body?.fee_bps === 'number' ? body.fee_bps : undefined,
          slippage_bps: typeof body?.slippage_bps === 'number' ? body.slippage_bps : undefined,
          source_run_id: typeof body?.source_run_id === 'string' ? body.source_run_id : undefined,
        }));
      }
      if (method === 'POST' && segments[0] === 'strategies' && segments[2] === 'backtest-runs') return json(await demoApi.submitBacktestRun(segments[1], {
        idempotency_key: readIdempotencyKey(request, body),
        start_date: typeof body?.start_date === 'string' ? body.start_date : undefined,
        end_date: typeof body?.end_date === 'string' ? body.end_date : undefined,
        parameter_version_id: typeof body?.parameter_version_id === 'string' ? body.parameter_version_id : undefined,
        dataset_snapshot_id: typeof body?.dataset_snapshot_id === 'string' ? body.dataset_snapshot_id : undefined,
        universe_snapshot_id: typeof body?.universe_snapshot_id === 'string' ? body.universe_snapshot_id : undefined,
        execution_policy: typeof body?.execution_policy === 'string' ? body.execution_policy : undefined,
        fee_bps: typeof body?.fee_bps === 'number' ? body.fee_bps : undefined,
        slippage_bps: typeof body?.slippage_bps === 'number' ? body.slippage_bps : undefined,
        source_run_id: typeof body?.source_run_id === 'string' ? body.source_run_id : undefined,
        simulate_warning: Boolean(body?.simulate_warning),
        is_permanent: typeof body?.is_permanent === 'boolean' ? body.is_permanent : undefined,
      }));
      if (method === 'POST' && segments[0] === 'backtest-runs' && segments[2] === 'clone') return json(await demoApi.cloneBacktestRun(segments[1], readIdempotencyKey(request, body)));
      if (method === 'GET' && url.pathname === '/leg-inventory') {
        return json(await demoApi.getLegInventory!());
      }
      if (method === 'POST' && url.pathname === '/asset-legs') {
        return json(await demoApi.createAssetLeg!(body as import('./types').ApiAssetLegCreatePayload));
      }
      if (method === 'PATCH' && segments[0] === 'asset-legs' && segments.length === 2) {
        return json(await demoApi.updateAssetLeg!(segments[1], body as import('./types').ApiAssetLegUpdatePayload));
      }
      if (method === 'POST' && url.pathname === '/cash-legs') {
        return json(await demoApi.createCashLeg!(body as import('./types').ApiCashLegCreatePayload));
      }
      if (method === 'PATCH' && segments[0] === 'cash-legs' && segments.length === 2) {
        return json(await demoApi.updateCashLeg!(segments[1], body as import('./types').ApiCashLegUpdatePayload));
      }
      if (method === 'GET' && url.pathname === '/compositions') {
        return json(await demoApi.listCompositions!());
      }
      if (method === 'GET' && segments[0] === 'compositions' && segments.length === 2) {
        return json(await demoApi.getCompositionDetail!(segments[1]));
      }
      if (method === 'POST' && url.pathname === '/compositions/preview') {
        return json(await demoApi.previewComposition!(body as import('./types').ApiCompositionPreviewPayload));
      }
      if (method === 'POST' && url.pathname === '/compositions') {
        return json(await demoApi.createComposition!(body as import('./types').ApiCompositionCreatePayload));
      }
      if (method === 'PATCH' && segments[0] === 'compositions' && segments.length === 2) {
        return json(await demoApi.updateComposition!(
          segments[1],
          body as import('./types').ApiCompositionUpdatePayload,
        ));
      }
      if (method === 'GET' && url.pathname === '/optimization-jobs') return json(await demoApi.listOptimizationJobs());
      if (method === 'GET' && segments[0] === 'optimization-jobs' && segments[2] === 'detail') return json(await demoApi.getOptimizationJobDetail(segments[1]));
      if (method === 'POST' && segments[0] === 'strategies' && segments[2] === 'optimization-jobs') {
        return json(await demoApi.createOptimizationJob(segments[1], {
          objective: typeof body?.objective === 'string' ? body.objective : undefined,
          base_parameter_version_id:
            typeof body?.base_parameter_version_id === 'string' ? body.base_parameter_version_id : null,
          source_run_id: typeof body?.source_run_id === 'string' ? body.source_run_id : null,
          entry_point: typeof body?.entry_point === 'string' ? body.entry_point : null,
          validation_mode: typeof body?.validation_mode === 'string' ? body.validation_mode : undefined,
          budget_combinations: typeof body?.budget_combinations === 'number' ? body.budget_combinations : undefined,
          search_space: Array.isArray(body?.search_space)
            ? (body?.search_space as import('./types').ApiOptimizationSearchSpaceField[])
            : undefined,
        }));
      }
      if (method === 'DELETE' && segments[0] === 'optimization-jobs' && segments.length === 2) {
        return json(await demoApi.deleteOptimizationJob(segments[1]));
      }
      if (method === 'POST' && segments[0] === 'optimization-jobs' && segments[2] === 'candidates' && segments.length === 3) {
        return json(await demoApi.createOptimizationCandidate(segments[1], {
          label: typeof body?.label === 'string' ? body.label : undefined,
          parameter_snapshot: (body?.parameter_snapshot as Record<string, import('./types').ParameterValue> | undefined) ?? {},
          base_parameter_version_id: typeof body?.base_parameter_version_id === 'string' ? body.base_parameter_version_id : undefined,
          metrics: (body?.metrics as Record<string, number> | undefined) ?? {},
          summary: typeof body?.summary === 'string' ? body.summary : undefined,
        }));
      }
      if (method === 'POST' && segments[0] === 'optimization-jobs' && segments[2] === 'candidates' && segments[4] === 'promote') {
        return json(await demoApi.promoteOptimizationCandidate(
          segments[1],
          segments[3],
          String(body?.mode ?? 'set_current') as 'set_current' | 'create_copy',
          readIdempotencyKey(request, body),
          typeof body?.comment === 'string' ? body.comment : undefined,
          typeof body?.base_parameter_version_id === 'string' ? body.base_parameter_version_id : undefined,
        ));
      }
      if (method === 'DELETE' && segments[0] === 'optimization-jobs' && segments[2] === 'candidates' && segments.length === 4) {
        return json(await demoApi.deleteOptimizationCandidate(segments[1], segments[3]));
      }
      if (method === 'GET' && url.pathname === '/data-snapshots/overview') return json(await demoApi.getSnapshotOverview());
        if (method === 'POST' && url.pathname === '/admin/snapshot-refresh-jobs') {
          return json(await demoApi.refreshSnapshots(body as import('./types').ApiSnapshotRefreshRequest | undefined));
        }

      return json({ status: 404, code: 'not_found', message: `No mock handler for ${method} ${url.pathname}` }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  });

  return {
    fetchSpy,
    restore: () => {
      fetchSpy.mockRestore();
      resetDemoStore();
    },
  };
}

export function setMockPromoteConflict(jobId: string, candidateId: string): void {
  setPromoteConflict(jobId, candidateId);
}

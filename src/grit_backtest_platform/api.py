from __future__ import annotations

import os
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .models import (
    BacktestRunCloneRequest,
    BacktestRunCreateRequest,
    BacktestRunPreviewRequest,
    ConfirmationUpdateRequest,
    CreateCreationSessionRequest,
    CreationMessageCreate,
    MaterializeRequest,
    OptimizationCandidateCreateRequest,
    OptimizationJobCreateRequest,
    PromoteTrialRequest,
    PrepareConfirmationRequest,
    SnapshotRefreshRequest,
    StrategyUpdateRequest,
)
from .real_service import RealBacktestPlatformService, SnapshotBlockingError
from .service import ContractConflictError


def _default_db_path() -> Path:
    configured = os.getenv('GRIT_BACKTEST_DB')
    return Path(configured) if configured else Path.cwd() / '.grit_backtest_platform.sqlite3'


def create_app(db_path: str | Path | None = None, market_data_provider=None) -> FastAPI:
    app = FastAPI(title='Grit Backtest Platform', version='0.1.0')
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            'http://127.0.0.1:4173',
            'http://localhost:4173',
            'http://127.0.0.1:5173',
            'http://localhost:5173',
        ],
        allow_methods=['*'],
        allow_headers=['*'],
    )
    service = RealBacktestPlatformService(db_path or _default_db_path(), market_data_provider=market_data_provider)
    app.state.service = service
    app.state.cleanup_stop_event = threading.Event()
    app.state.cleanup_thread = None

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_: Request, exc: HTTPException):
        payload = exc.detail if isinstance(exc.detail, dict) else {'status': exc.status_code, 'code': 'error', 'message': str(exc.detail)}
        return JSONResponse(status_code=exc.status_code, content=payload)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(_: Request, exc: RequestValidationError):
        message = exc.errors()[0]['msg'] if exc.errors() else 'Validation error'
        return JSONResponse(status_code=422, content={'status': 422, 'code': 'validation_error', 'message': message})

    def invoke(callback, *args, **kwargs):
        try:
            return callback(*args, **kwargs)
        except SnapshotBlockingError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        except ContractConflictError as exc:
            raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc
        except KeyError as exc:
            raise HTTPException(status_code=404, detail={'status': 404, 'code': 'not_found', 'message': str(exc)}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={'status': 400, 'code': 'bad_request', 'message': str(exc)}) from exc

    def run_cleanup_cycle() -> None:
        try:
            invoke(service.purge_expired_temporary_runs)
        except Exception:
            pass

    @app.on_event('startup')
    def startup_cleanup_worker():
        run_cleanup_cycle()

        def loop() -> None:
            while not app.state.cleanup_stop_event.wait(6 * 60 * 60):
                run_cleanup_cycle()

        thread = threading.Thread(target=loop, name='cleanup-worker', daemon=True)
        app.state.cleanup_thread = thread
        thread.start()

    @app.on_event('shutdown')
    def shutdown_cleanup_worker():
        app.state.cleanup_stop_event.set()
        thread = app.state.cleanup_thread
        if thread and thread.is_alive():
            thread.join(timeout=5)

    @app.get('/workspace/overview')
    def workspace_overview(include_cleanup_audit: bool = Query(default=False)):
        return invoke(service.get_workspace_overview, include_cleanup_audit)

    @app.get('/strategies')
    def list_strategies():
        return invoke(service.list_strategies)

    @app.get('/strategies/{strategy_id}/detail')
    def strategy_detail(strategy_id: str):
        return invoke(service.get_strategy_detail, strategy_id)

    @app.patch('/strategies/{strategy_id}')
    def patch_strategy(strategy_id: str, payload: StrategyUpdateRequest):
        return invoke(service.update_strategy, strategy_id, payload)

    @app.post('/strategy-creation-sessions')
    def create_creation_session(payload: CreateCreationSessionRequest | None = None):
        return invoke(service.create_creation_session, payload or CreateCreationSessionRequest())

    @app.get('/strategy-creation-sessions/{session_id}')
    def get_creation_session(session_id: str):
        return invoke(service.get_creation_session, session_id)

    @app.post('/strategy-creation-sessions/{session_id}/messages')
    def append_creation_message(session_id: str, payload: CreationMessageCreate):
        return invoke(service.append_creation_message, session_id, payload)

    @app.post('/strategy-creation-sessions/{session_id}/prepare-confirmation')
    def prepare_confirmation(session_id: str, payload: PrepareConfirmationRequest | None = None):
        return invoke(service.prepare_confirmation, session_id, payload or PrepareConfirmationRequest())

    @app.patch('/strategy-creation-sessions/{session_id}/confirmation')
    def update_creation_confirmation(session_id: str, payload: ConfirmationUpdateRequest):
        updater = getattr(service, 'update_creation_confirmation', service.update_confirmation)
        return invoke(updater, session_id, payload)

    @app.post('/strategy-creation-sessions/{session_id}/materialize')
    def materialize_strategy(session_id: str, payload: MaterializeRequest):
        return invoke(service.materialize_strategy, session_id, payload)

    @app.get('/backtest-runs')
    def list_backtest_runs(limit: int | None = Query(default=None, ge=1), status: str | None = None):
        return invoke(service.list_backtest_runs, limit=limit, status=status)

    @app.get('/backtest-runs/{run_id}/detail')
    def backtest_run_detail(run_id: str):
        return invoke(service.get_backtest_run_detail, run_id)

    @app.get('/backtest-runs/{run_id}/trades')
    def backtest_run_trades(run_id: str, page: int = 1, page_size: int = 50, segment: str = 'all'):
        return invoke(service.get_backtest_run_trades, run_id, page=page, page_size=page_size, segment=segment)

    @app.get('/backtest-runs/{run_id}/trades/{trade_id}/audit')
    def backtest_trade_audit(run_id: str, trade_id: str):
        return invoke(service.get_backtest_trade_audit, run_id, trade_id)

    @app.post('/strategies/{strategy_id}/backtest-runs')
    def submit_backtest_run(strategy_id: str, payload: BacktestRunCreateRequest):
        return invoke(service.submit_backtest_run, strategy_id, payload)

    @app.post('/strategies/{strategy_id}/backtest-runs/preview')
    def preview_backtest_run(strategy_id: str, payload: BacktestRunPreviewRequest | None = None):
        return invoke(service.preview_backtest_run, strategy_id, payload or BacktestRunPreviewRequest())

    @app.post('/backtest-runs/{run_id}/clone')
    def clone_backtest_run(run_id: str, payload: BacktestRunCloneRequest):
        return invoke(service.clone_backtest_run, run_id, payload)

    @app.get('/optimization-jobs/{job_id}/detail')
    def optimization_job_detail(job_id: str):
        return invoke(service.get_optimization_job_detail, job_id)

    @app.post('/strategies/{strategy_id}/optimization-jobs')
    def create_optimization_job(strategy_id: str, payload: OptimizationJobCreateRequest | None = None):
        return invoke(service.create_optimization_job, strategy_id, payload)

    @app.post('/optimization-jobs/{job_id}/candidates')
    def create_optimization_candidate(job_id: str, payload: OptimizationCandidateCreateRequest):
        return invoke(service.create_optimization_candidate, job_id, payload)

    @app.post('/optimization-jobs/{job_id}/candidates/{trial_id}/promote')
    def promote_candidate(job_id: str, trial_id: str, payload: PromoteTrialRequest):
        return invoke(service.promote_trial, job_id, trial_id, payload)

    @app.delete('/optimization-jobs/{job_id}/candidates/{trial_id}')
    def delete_candidate(job_id: str, trial_id: str):
        return invoke(service.delete_optimization_candidate, job_id, trial_id)

    @app.get('/data-snapshots/overview')
    def snapshot_overview():
        return invoke(service.get_snapshot_overview)

    @app.post('/admin/snapshot-refresh-jobs')
    def refresh_snapshots(payload: SnapshotRefreshRequest | None = None):
        return invoke(service.refresh_snapshots, payload)

    return app



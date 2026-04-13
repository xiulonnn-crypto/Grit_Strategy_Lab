from __future__ import annotations

import os
import threading
from pathlib import Path
import importlib
import json
from typing import Any

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
    ResumeOptimizationJobRequest,
    PromoteTrialRequest,
    PrepareConfirmationRequest,
    SnapshotRefreshRequest,
    StrategyUpdateRequest,
)
from .real_service import RealBacktestPlatformService, SnapshotBlockingError
from .service import ContractConflictError
from .universe_history import default_universe_history_providers
from .yahoo_provider import YahooMarketDataProvider


def _provider_name(provider: Any) -> str:
    return str(getattr(provider, "provider_name", provider.__class__.__name__.lower()))


def _load_provider(module_name: str, class_names: tuple[str, ...]) -> Any | None:
    try:
        module = importlib.import_module(f".{module_name}", package=__package__)
    except Exception:
        return None
    for class_name in class_names:
        provider_class = getattr(module, class_name, None)
        if provider_class is None:
            continue
        try:
            provider = provider_class()
        except Exception:
            continue
        availability = getattr(provider, "availability", None)
        if callable(availability):
            try:
                report = availability()
            except Exception:
                continue
            if not getattr(report, "available", False):
                continue
        return provider
    return None


def _merge_action_payload(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = dict(existing)
    if merged.get("value") is None and incoming.get("value") is not None:
        merged["value"] = incoming.get("value")
    if not merged.get("source") and incoming.get("source"):
        merged["source"] = incoming.get("source")
    if not merged.get("fallback_source") and incoming.get("fallback_source"):
        merged["fallback_source"] = incoming.get("fallback_source")
    merged_payload = dict(merged.get("payload") or {})
    for key, value in dict(incoming.get("payload") or {}).items():
        if key not in merged_payload or merged_payload.get(key) is None:
            merged_payload[key] = value
    if merged_payload:
        merged["payload"] = merged_payload
    return merged


def _dedupe_actions(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    index_by_signature: dict[str, int] = {}
    deduped: list[dict[str, Any]] = []
    for action in actions:
        signature = json.dumps(
            {
                "symbol": str(action.get("symbol") or "").strip().upper(),
                "date": action.get("date") or action.get("event_date"),
                "action_type": action.get("action_type") or action.get("event_type"),
            },
            ensure_ascii=False,
            sort_keys=True,
            default=str,
        )
        existing_index = index_by_signature.get(signature)
        if existing_index is None:
            index_by_signature[signature] = len(deduped)
            deduped.append(dict(action))
            continue
        deduped[existing_index] = _merge_action_payload(deduped[existing_index], action)
    return deduped


class RuntimeMarketDataProvider:
    provider_name = "yahoo"

    def __init__(self, providers: list[Any], missing_providers: list[str] | None = None) -> None:
        self.providers = [provider for provider in providers if provider is not None]
        self.universe_history_providers = list(default_universe_history_providers())
        self.price_providers = [
            provider
            for provider in self.providers
            if callable(getattr(provider, "fetch_history", None))
            and _provider_name(provider) not in {"alpha_vantage", "sec_edgar"}
        ]
        self.identity_providers = [
            provider for provider in self.providers if callable(getattr(provider, "resolve_identity", None))
        ]
        self.earnings_providers = [
            provider for provider in self.providers if callable(getattr(provider, "fetch_earnings", None))
        ]
        self.report_providers = [
            provider for provider in self.providers if callable(getattr(provider, "fetch_report_filings", None))
        ]
        self.fallback_provider = self.price_providers[1] if len(self.price_providers) > 1 else None
        self.missing_providers = list(missing_providers or [])

    def scoped_copy(self, *, exclude_provider_names: set[str] | list[str] | tuple[str, ...] | None = None) -> "RuntimeMarketDataProvider":
        excluded = {str(name or "").strip().lower() for name in (exclude_provider_names or []) if str(name or "").strip()}
        if not excluded:
            clone = type(self)(list(self.providers), missing_providers=list(self.missing_providers))
            clone.universe_history_providers = list(self.universe_history_providers)
            return clone
        filtered = [
            provider
            for provider in self.providers
            if _provider_name(provider).strip().lower() not in excluded
        ]
        clone = type(self)(filtered, missing_providers=list(self.missing_providers))
        clone.universe_history_providers = list(self.universe_history_providers)
        return clone

    def resolve_identity(self, symbol: str) -> dict[str, Any] | None:
        for provider in self.identity_providers:
            resolver = getattr(provider, "resolve_identity", None)
            if resolver is None:
                continue
            try:
                identity = resolver(symbol)
            except Exception:
                continue
            if isinstance(identity, dict) and identity.get("symbol"):
                return identity
        return None

    def _normalize_history_payload(self, provider_name: str, result: Any) -> dict[str, Any]:
        if isinstance(result, dict):
            payload = dict(result)
        else:
            payload = {
                "source": getattr(result, "source", None),
                "fallback_source": getattr(result, "fallback_source", None),
                "bars": list(getattr(result, "bars", []) or []),
                "actions": list(getattr(result, "actions", []) or []),
                "warnings": list(getattr(result, "warnings", []) or []),
                "partial": bool(getattr(result, "partial", False)),
                "metadata": dict(getattr(result, "metadata", {}) or {}),
            }
        payload.setdefault("source", provider_name)
        payload.setdefault("fallback_source", None)
        payload.setdefault("bars", [])
        payload.setdefault("actions", [])
        payload.setdefault("warnings", [])
        payload.setdefault("partial", False)
        payload.setdefault("metadata", {})
        return payload

    def _append_actions(
        self,
        actions: list[dict[str, Any]],
        rows: list[dict[str, Any]],
        provider_name: str,
        *,
        primary_source: str | None,
    ) -> None:
        for item in rows:
            action = dict(item)
            action.setdefault("source", provider_name)
            if (
                primary_source
                and action.get("source") != primary_source
                and not action.get("fallback_source")
            ):
                action["fallback_source"] = action.get("source")
            actions.append(action)

    def _supports_action_enrichment(self, provider: Any) -> bool:
        return bool(getattr(provider, "supports_action_enrichment", False))

    def fetch_history(self, symbol, start_date, end_date):
        warnings: list[str] = []
        provider_results: list[dict[str, Any]] = []
        missing_labels: list[str] = []
        primary_source: str | None = None
        bars: list[Any] = []
        actions: list[dict[str, Any]] = []
        identity = self.resolve_identity(symbol)

        for index, provider in enumerate(self.price_providers):
            provider_name = _provider_name(provider)
            try:
                payload = self._normalize_history_payload(
                    provider_name,
                    provider.fetch_history(symbol, start_date, end_date),
                )
            except Exception as exc:
                missing_labels.append(provider_name)
                warnings.append(f"{provider_name}: {exc}")
                continue

            provider_warnings = list(payload["warnings"] or [])
            warnings.extend(str(item) for item in provider_warnings if item)
            provider_bars = list(payload.get("bars") or [])
            provider_actions = [dict(item) for item in (payload["actions"] or []) if isinstance(item, dict)]
            provider_results.append(
                {
                    "provider": provider_name,
                    "kind": "history",
                    "source": str(payload.get("source") or provider_name),
                    "fallback_source": payload.get("fallback_source"),
                    "bar_count": len(provider_bars),
                    "action_count": len(provider_actions),
                    "partial": bool(payload.get("partial")),
                }
            )

            if provider_bars and not bars:
                bars = provider_bars
                primary_source = str(payload.get("source") or provider_name)
            if provider_actions:
                self._append_actions(actions, provider_actions, provider_name, primary_source=primary_source)
            if bars and not any(
                self._supports_action_enrichment(candidate)
                for candidate in self.price_providers[index + 1 :]
            ):
                break

        for provider in self.earnings_providers:
            provider_name = _provider_name(provider)
            fetch_earnings = getattr(provider, "fetch_earnings", None)
            if fetch_earnings is None:
                continue
            try:
                earnings_rows = list(fetch_earnings(symbol) or [])
            except Exception as exc:
                missing_labels.append(provider_name)
                warnings.append(f"{provider_name}: {exc}")
                continue
            converted: list[dict[str, Any]] = []
            for item in earnings_rows:
                if not isinstance(item, dict):
                    continue
                reported_date = str(item.get("reported_date") or "")[:10]
                if not reported_date or reported_date < start_date.isoformat() or reported_date > end_date.isoformat():
                    continue
                converted.append(
                    {
                        "date": reported_date,
                        "action_type": "earnings_report",
                        "value": item.get("reported_eps"),
                        "source": provider_name,
                        "payload": {
                            "period": item.get("period"),
                            "fiscal_date_ending": item.get("fiscal_date_ending"),
                            "reported_eps": item.get("reported_eps"),
                            "estimated_eps": item.get("estimated_eps"),
                            "surprise": item.get("surprise"),
                            "surprise_percentage": item.get("surprise_percentage"),
                        },
                    }
                )
            provider_results.append(
                {
                    "provider": provider_name,
                    "kind": "earnings",
                    "source": provider_name,
                    "fallback_source": None,
                    "bar_count": 0,
                    "action_count": len(converted),
                    "partial": False,
                }
            )
            self._append_actions(actions, converted, provider_name, primary_source=primary_source)

        for provider in self.report_providers:
            provider_name = _provider_name(provider)
            fetch_report_filings = getattr(provider, "fetch_report_filings", None)
            if fetch_report_filings is None:
                continue
            try:
                filing_rows = list(fetch_report_filings(symbol, start_date, end_date) or [])
            except Exception as exc:
                missing_labels.append(provider_name)
                warnings.append(f"{provider_name}: {exc}")
                continue
            converted = [dict(item) for item in filing_rows if isinstance(item, dict)]
            provider_results.append(
                {
                    "provider": provider_name,
                    "kind": "filings",
                    "source": provider_name,
                    "fallback_source": None,
                    "bar_count": 0,
                    "action_count": len(converted),
                    "partial": False,
                }
            )
            self._append_actions(actions, converted, provider_name, primary_source=primary_source)

        actions = _dedupe_actions(actions)
        if not bars:
            raise RuntimeError(
                f"No provider returned market data for {symbol}. "
                + ("; ".join(warnings) if warnings else "No usable providers were configured.")
            )

        contributing_sources = sorted(
            {
                str(item.get("source") or "")
                for item in actions
                if item.get("source")
            }
            | {primary_source or ""}
        )
        fallback_sources = sorted(
            {
                str(action.get("fallback_source"))
                for action in actions
                if action.get("fallback_source") and str(action.get("fallback_source")) != (primary_source or "")
            }
        )
        primary_source = primary_source or (self.price_providers[0].provider_name if self.price_providers else "yahoo")
        secondary_sources = [source for source in contributing_sources if source and source != primary_source]
        fallback_source: str | None = None
        if fallback_sources:
            fallback_source = fallback_sources[0] if len(fallback_sources) == 1 else "mixed_fallbacks"
        elif secondary_sources:
            fallback_source = secondary_sources[0] if len(secondary_sources) == 1 else "mixed_fallbacks"
        elif len(self.price_providers) > 1:
            fallback_source = "mixed_fallbacks"

        provider_gaps = list(self.missing_providers)
        return {
            "symbol": symbol,
            "bars": bars,
            "actions": actions,
            "source": primary_source,
            "fallback_source": fallback_source,
            "warnings": warnings,
            "partial": bool(missing_labels or provider_gaps),
            "metadata": {
                "provider_chain": [_provider_name(provider) for provider in self.providers],
                "provider_results": provider_results,
                "bar_source": primary_source,
                "fallback_sources": fallback_sources or secondary_sources,
                "missing_providers": provider_gaps + missing_labels,
                "identity": identity or {},
            },
        }


def build_runtime_market_data_provider() -> RuntimeMarketDataProvider:
    providers: list[Any] = [YahooMarketDataProvider()]
    missing_providers: list[str] = []
    for module_name, class_names in (
        ("tiingo_provider", ("TiingoMarketDataProvider", "TiingoProvider")),
        ("tiingo_symbology_provider", ("TiingoSymbologyProvider",)),
        ("longbridge_provider", ("LongbridgeStaticInfoProvider",)),
        ("longbridge_provider", ("LongbridgeQuoteProvider",)),
        ("akshare_us_provider", ("AkshareUsPriceProvider", "AkShareUsPriceProvider")),
        ("fmp_identity_provider", ("FmpIdentityRepairProvider", "FmpMarketDataProvider", "FmpPriceRepairProvider")),
        ("alpha_vantage_provider", ("AlphaVantageProvider", "AlphaVantageEventProvider", "AlphaVantageMarketDataProvider")),
        ("sec_edgar_provider", ("SecEdgarEventProvider", "SecEdgarProvider")),
    ):
        provider = _load_provider(module_name, class_names)
        if provider is not None:
            providers.append(provider)
        else:
            missing_providers.append(module_name)
    return RuntimeMarketDataProvider(providers, missing_providers=missing_providers)


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
    resolved_market_data_provider = market_data_provider
    if resolved_market_data_provider is None and "PYTEST_CURRENT_TEST" not in os.environ:
        resolved_market_data_provider = build_runtime_market_data_provider()
    service = RealBacktestPlatformService(
        db_path or _default_db_path(),
        market_data_provider=resolved_market_data_provider,
    )
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
        try:
            invoke(service.resume_incomplete_backtest_runs)
        except Exception:
            pass
        try:
            invoke(service.resume_incomplete_optimization_jobs)
        except Exception:
            pass

        def loop() -> None:
            while not app.state.cleanup_stop_event.wait(24 * 60 * 60):
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

    @app.get('/healthz')
    def healthz():
        return {'status': 'ok'}

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
    def backtest_run_detail(run_id: str, view: str = Query(default="full")):
        return invoke(service.get_backtest_run_detail, run_id, view=view)

    @app.post('/backtest-runs/{run_id}/save')
    def save_backtest_run(run_id: str):
        return invoke(service.save_backtest_run, run_id)

    @app.delete('/backtest-runs/{run_id}')
    def delete_backtest_run(run_id: str):
        return invoke(service.delete_backtest_run, run_id)

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

    @app.get('/optimization-jobs')
    def list_optimization_jobs():
        return invoke(service.list_optimization_jobs)

    @app.get('/optimization-jobs/{job_id}/detail')
    def optimization_job_detail(job_id: str):
        return invoke(service.get_optimization_job_detail, job_id)

    @app.delete('/optimization-jobs/{job_id}')
    def delete_optimization_job(job_id: str):
        return invoke(service.delete_optimization_job, job_id)

    @app.post('/strategies/{strategy_id}/optimization-jobs')
    def create_optimization_job(strategy_id: str, payload: OptimizationJobCreateRequest | None = None):
        return invoke(service.create_optimization_job, strategy_id, payload)

    @app.post('/optimization-jobs/{job_id}/resume')
    def resume_optimization_job(job_id: str, payload: ResumeOptimizationJobRequest):
        return invoke(service.resume_optimization_job, job_id, payload)

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
        request_payload = payload or SnapshotRefreshRequest()
        if "PYTEST_CURRENT_TEST" in os.environ:
            return invoke(service.refresh_snapshots, request_payload)
        starter = getattr(service, "start_snapshot_refresh", None)
        if callable(starter):
            return invoke(starter, request_payload)
        return invoke(service.refresh_snapshots, request_payload)

    return app



import { useEffect, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { ApiError, type ApiBacktestSubmissionPreview, type ApiStrategyDetail } from '../types';
import './creation-backtest.css';

function KeyValue({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="kv-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function BacktestSubmitPage({ strategyId }: { strategyId: string }): JSX.Element {
  const api = useApiClient();
  const [strategy, setStrategy] = useState<ApiStrategyDetail | null>(null);
  const [preview, setPreview] = useState<ApiBacktestSubmissionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startDate, setStartDate] = useState('2024-03-01');
  const [endDate, setEndDate] = useState('2025-03-31');

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const payload = await api.getStrategyDetail(strategyId);
        if (!cancelled) {
          setStrategy(payload);
        }
      } catch (caught) {
        if (!cancelled) {
          setError((caught as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [api, strategyId]);

  async function refreshSnapshots(): Promise<void> {
    try {
      setBusy(true);
      setError(null);
      await api.refreshSnapshots();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runPreview(): Promise<void> {
    if (!startDate || !endDate) {
      setError('Choose both start and end dates before preview.');
      return;
    }
    if (startDate > endDate) {
      setError('Start date must be earlier than or equal to end date.');
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const payload = await api.previewBacktestRun(strategyId, {
        start_date: startDate,
        end_date: endDate,
      });
      setPreview(payload);
    } catch (caught) {
      const errorValue = caught as ApiError;
      setError(
        errorValue.blocking_code
          ? `${errorValue.message} (${errorValue.blocking_code})`
          : errorValue.message,
      );
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    if (!startDate || !endDate) {
      setError('Choose both start and end dates before submitting.');
      return;
    }
    if (startDate > endDate) {
      setError('Start date must be earlier than or equal to end date.');
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const payload = await api.submitBacktestRun(strategyId, {
        idempotency_key: `run-${strategyId}`,
        start_date: startDate,
        end_date: endDate,
      });
      navigateTo(`/runs/${payload.id}`);
    } catch (caught) {
      const errorValue = caught as ApiError;
      setError(
        errorValue.blocking_code
          ? `${errorValue.message} (${errorValue.blocking_code})`
          : errorValue.message,
      );
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="panel backtest-submit-page">
        <div className="panel-header">
          <h2>Backtest</h2>
        </div>
        <p className="hero-copy">Loading strategy {strategyId}...</p>
      </section>
    );
  }

  return (
    <div className="stack backtest-submit-page">
      <section className="panel">
        <div className="panel-header">
          <h2>{strategy?.name ?? strategyId}</h2>
          <span className="status-chip">{strategy?.strategy_type ?? 'LOADING'}</span>
        </div>
        <p className="hero-copy">
          Validate the date window, preview the backend contract, and submit when the strategy is ready.
        </p>

        <div className="kv-grid">
          <KeyValue label="Universe" value={strategy?.universe_name ?? '-'} />
          <KeyValue label="Start date" value={startDate} />
          <KeyValue label="End date" value={endDate} />
        </div>

        <div className="date-row">
          <label>
            <span>Start</span>
            <input onChange={(event) => setStartDate(event.target.value)} type="date" value={startDate} />
          </label>
          <label>
            <span>End</span>
            <input onChange={(event) => setEndDate(event.target.value)} type="date" value={endDate} />
          </label>
        </div>

        <div className="hero-actions">
          <button className="ghost-button" disabled={busy} onClick={() => void refreshSnapshots()} type="button">
            Refresh snapshots
          </button>
          <button className="primary-button" disabled={busy} onClick={() => void runPreview()} type="button">
            Preview run
          </button>
          <button className="ghost-button" disabled={busy} onClick={() => void submit()} type="button">
            Submit run
          </button>
        </div>

        {error ? <div className="error-banner">{error}</div> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Preview contract</h3>
        </div>
        {preview ? (
          <>
            <div className="kv-grid">
              <KeyValue label="Effective start" value={String(preview.effective_start_date ?? '-')} />
              <KeyValue label="Effective end" value={String(preview.effective_end_date ?? '-')} />
              <KeyValue label="Segment" value={String(preview.data_segment_type ?? '-')} />
            </div>
            {preview.warnings?.length ? (
              <div className="parameter-list">
                {preview.warnings.map((warning, index) => (
                  <div className="parameter-row" key={`${warning}-${index}`}>
                    <strong>Warning</strong>
                    <span>{warning}</span>
                    <small>Preview</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">No preview warnings were returned.</p>
            )}
          </>
        ) : (
          <p className="empty-state">Run preview to inspect the backend contract before submission.</p>
        )}
      </section>
    </div>
  );
}

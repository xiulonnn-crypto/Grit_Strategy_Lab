import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { ApiError, type ApiStrategyCreationSession, type ParameterValue } from '../types';
import './creation-backtest.css';

function KeyValue({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="kv-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function CreationSessionPage({ sessionId }: { sessionId: string }): JSX.Element {
  const api = useApiClient();
  const [session, setSession] = useState<ApiStrategyCreationSession | null>(null);
  const [draft, setDraft] = useState(
    'Build a momentum strategy on QQQ with 100000 capital, top 10 names, 10 percent max position, weekly rebalance, and 5 percent stop loss.',
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editableParameters, setEditableParameters] = useState<Record<string, string>>({});

  const confirmationFields = session?.confirmation_fields?.parameters ?? [];
  const canPatchConfirmation = session?.revision !== undefined && confirmationFields.length > 0;

  function normalizeFieldValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value);
  }

  function toParameterValue(value: string): ParameterValue {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    if (trimmed === 'true') {
      return true;
    }
    if (trimmed === 'false') {
      return false;
    }
    const maybeNumber = Number(trimmed);
    if (!Number.isNaN(maybeNumber) && trimmed === String(maybeNumber)) {
      return maybeNumber;
    }
    return trimmed;
  }

  function syncEditableParameters(nextSession: ApiStrategyCreationSession): void {
    const nextEntries =
      nextSession.confirmation_fields?.parameters?.map((field) => [
        field.key,
        normalizeFieldValue(field.value),
      ] as const) ?? [];
    setEditableParameters(Object.fromEntries(nextEntries));
  }

  const helperCopy = useMemo(() => {
    if (!session) {
      return 'Loading the creation session from the backend.';
    }
    if (error) {
      return error;
    }
    if (session.pending_inputs?.length) {
      return 'The backend still needs more inputs before the draft is final.';
    }
    return 'Review the current draft, patch any confirmation values, and materialize into backtest.';
  }, [error, session]);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const nextSession = await api.getCreationSession(sessionId);
        if (!cancelled) {
          setSession(nextSession);
          syncEditableParameters(nextSession);
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
  }, [api, sessionId]);

  async function sendPrompt(): Promise<void> {
    if (!draft.trim()) {
      setError('Enter a strategy prompt before sending a message.');
      return;
    }

    if (!session) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const updated = await api.appendCreationMessage(session.id, draft, session.revision);
      setSession(updated);
      syncEditableParameters(updated);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function prepareConfirmation(): Promise<void> {
    if (!session) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const updated = await api.prepareConfirmation(session.id);
      setSession(updated);
      syncEditableParameters(updated);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function patchConfirmation(): Promise<void> {
    if (!session?.revision) {
      setError('This session cannot be patched until the confirmation draft is prepared.');
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const updated = await api.updateConfirmation(session.id, {
        revision: session.revision,
        parameters: Object.fromEntries(
          Object.entries(editableParameters).map(([key, value]) => [key, toParameterValue(value)]),
        ),
      });
      setSession(updated);
      syncEditableParameters(updated);
    } catch (caught) {
      const errorValue = caught as ApiError;
      setError(errorValue.message);
    } finally {
      setBusy(false);
    }
  }

  async function materialize(): Promise<void> {
    if (!session) {
      return;
    }

    try {
      setBusy(true);
      setError(null);
      const strategy = await api.materializeStrategy(
        session.id,
        `materialize-${session.id}`,
        session.revision,
      );
      navigateTo(`/strategies/${strategy.id}/backtest-runs/new`);
    } catch (caught) {
      const errorValue = caught as ApiError;
      if (errorValue.code === 'stale_base_parameter_version') {
        setError('The base parameter version is stale. Refresh the session before materializing again.');
      } else {
        setError(errorValue.message);
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="panel creation-session-page">
        <div className="panel-header">
          <h2>Creation Session</h2>
        </div>
        <p className="hero-copy">Loading session {sessionId}...</p>
      </section>
    );
  }

  return (
    <div className="stack creation-session-page">
      <section className="panel">
        <div className="panel-header">
          <h2>Conversation Draft</h2>
          <span className="status-chip">{session?.status ?? 'BOOTSTRAPPING'}</span>
        </div>
        <p className="hero-copy">{helperCopy}</p>
        <textarea
          aria-label="Creation prompt"
          className="prompt-box"
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
        <div className="hero-actions">
          <button
            className="primary-button"
            disabled={busy || !session}
            onClick={() => void sendPrompt()}
            type="button"
          >
            Send message
          </button>
          <button
            className="ghost-button"
            disabled={busy || !session}
            onClick={() => void prepareConfirmation()}
            type="button"
          >
            Prepare confirmation
          </button>
          <button
            className="ghost-button"
            disabled={busy || !canPatchConfirmation}
            onClick={() => void patchConfirmation()}
            type="button"
          >
            Apply confirmation edits
          </button>
          <button
            className="ghost-button"
            disabled={busy || !session}
            onClick={() => void materialize()}
            type="button"
          >
            Materialize
          </button>
        </div>
        {error ? <div className="error-banner">{error}</div> : null}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Conversation</h3>
        </div>
        {session?.messages?.length ? (
          <div className="parameter-list">
            {session.messages.map((message, index) => (
              <div className="parameter-row" key={`${message.role ?? 'message'}-${index}`}>
                <strong>{message.role ?? 'assistant'}</strong>
                <span>{message.content}</span>
                <small>{message.created_at ?? 'pending'}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">No messages yet. Start with a strategy prompt above.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Top level</h3>
        </div>
        <div className="kv-grid">
          <KeyValue label="Strategy type" value={session?.top_level?.strategy_type ?? '-'} />
          <KeyValue label="Universe" value={session?.top_level?.universe_name ?? '-'} />
          <KeyValue label="Rebalance" value={session?.top_level?.rebalance_frequency ?? '-'} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Confirmation parameters</h3>
        </div>
        {session?.confirmation_fields?.parameters?.length ? (
          <div className="parameter-list">
            {session.confirmation_fields.parameters.map((field) => (
              <div className="parameter-row" key={field.key}>
                <span>{field.label}</span>
                <label>
                  <span className="sr-only">{field.label}</span>
                  <input
                    aria-label={field.label}
                    className="creation-inline-input"
                    disabled={busy}
                    onChange={(event) =>
                      setEditableParameters((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                    type="text"
                    value={editableParameters[field.key] ?? normalizeFieldValue(field.value)}
                  />
                </label>
                <small>{field.source}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">Prepare confirmation to inspect the current draft values.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Pending inputs</h3>
        </div>
        {session?.pending_inputs?.length ? (
          <div className="parameter-list">
            {session.pending_inputs.map((item) => (
              <div className="parameter-row" key={item.key}>
                <span>{item.label}</span>
                <strong>{item.key}</strong>
                <small>{item.message}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">No pending inputs. The session is ready for confirmation review.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <h3>Manual conflicts</h3>
        </div>
        {session?.manual_conflicts?.length ? (
          <div className="parameter-list">
            {session.manual_conflicts.map((conflict) => (
              <div className="parameter-row" key={conflict.key}>
                <span>{conflict.label}</span>
                <strong>
                  {conflict.suggested_value === undefined ? '-' : String(conflict.suggested_value)}
                </strong>
                <small>{conflict.message}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">No manual conflicts reported for this session.</p>
        )}
      </section>
    </div>
  );
}

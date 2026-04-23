import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { ApiError, type ApiConfirmationUpdateRequest, type ApiStrategyCreationSession, type ParameterValue } from '../types';
import './creation-backtest.css';

type EditableField = { key: string; label: string; source: string; value: unknown };
type FieldBucket = 'core' | 'logic' | 'parameters';
type GroupId = 'basic' | 'selection' | 'risk' | 'other';
type GroupConfig = { bucket: FieldBucket; id: GroupId; title: string };
type GroupedField = EditableField & GroupConfig;

const TEXT = {
  loadingTitle: '\u521b\u5efa\u4f1a\u8bdd',
  loadingCopy: '\u6b63\u5728\u4ece\u540e\u7aef\u52a0\u8f7d\u4f1a\u8bdd',
  defaultDraft:
    '\u8bf7\u56f4\u7ed5 QQQ \u6062\u590d\u4e00\u4e2a\u5747\u503c\u56de\u5f52\u7b56\u7565\uff0c\u5305\u542b\u80a1\u7968\u6c60\u3001\u56de\u770b\u7a97\u53e3\u3001\u5165\u573a/\u51fa\u573a\u89c4\u5219\u548c\u98ce\u63a7\u7ea6\u675f\u3002',
  pendingNeedsInput:
    '\u540e\u7aef\u8fd8\u9700\u8981\u8865\u5145\u8f93\u5165\uff0c\u624d\u80fd\u628a\u786e\u8ba4\u7a3f\u63a8\u8fdb\u5230\u53ef\u751f\u6210\u7b56\u7565\u7684\u72b6\u6001\u3002',
  readyCopy:
    '\u5bf9\u8bdd\u533a\u4f1a\u7ee7\u7eed\u79ef\u7d2f\u7ea6\u675f\uff0c\u53f3\u4fa7\u52a8\u6001\u8868\u5355\u7528\u4e8e\u68c0\u67e5\u786e\u8ba4\u7a3f\u548c\u624b\u52a8\u8986\u76d6\u3002',
  backToWorkspace: '\u8fd4\u56de\u5de5\u4f5c\u53f0',
  sendMessage: '\u53d1\u9001\u6d88\u606f',
  prepare: '\u6253\u5f00\u786e\u8ba4\u7a3f',
  applyDraft: '\u5e94\u7528\u786e\u8ba4\u7a3f',
  materialize: '\u751f\u6210\u7b56\u7565',
  chatTitle: '\u5bf9\u8bdd',
  chatCopy: '\u7531\u660e\u786e\u7684\u521b\u5efa\u4f1a\u8bdd\u9a71\u52a8\u6a21\u62df LLM \u5bf9\u8bdd\u3002',
  composerTitle: '\u6d88\u606f',
  formTitle: '\u52a8\u6001\u8868\u5355\u63a7\u5236\u53f0',
  formCopy: '\u5de6\u4fa7\u5bf9\u8bdd\u63d0\u53d6\u53c2\u6570\uff0c\u53f3\u4fa7\u53ef\u76f4\u63a5\u624b\u52a8\u8986\u76d6\u3002',
  basic: '\u57fa\u7840\u914d\u7f6e',
  selection: '\u9009\u80a1\u89c4\u5219',
  risk: '\u98ce\u63a7/\u518d\u5e73\u8861',
  other: '\u5176\u4ed6\u53c2\u6570',
  topLevelTitle: '\u4f1a\u8bdd\u6458\u8981',
  topLevelEmpty: '\u6682\u65e0\u9876\u5c42\u6458\u8981\u3002',
  pendingTitle: '\u5f85\u8865\u5165\u53c2',
  pendingEmpty: '\u6682\u65e0\u5f85\u8865\u5165\u53c2\uff0c\u5f53\u524d\u4f1a\u8bdd\u53ef\u8fdb\u5165\u786e\u8ba4\u7a3f\u68c0\u67e5\u3002',
  conflictsTitle: '\u624b\u52a8\u51b2\u7a81',
  conflictsEmpty: '\u6682\u65e0\u624b\u52a8\u51b2\u7a81\u3002',
  noMessages: '\u8fd8\u6ca1\u6709\u5bf9\u8bdd\u6d88\u606f\uff0c\u53ef\u4ece\u5f53\u524d\u7ea6\u675f\u6216\u4fee\u6539\u8bf4\u660e\u5f00\u59cb\u3002',
  promptLabel: '\u521b\u5efa\u6d88\u606f',
  statusReady: '\u5df2\u5b8c\u6210',
  statusManual: '\u4eba\u5de5\u4fee\u6b63',
  statusSystem: '\u7cfb\u7edf\u63a8\u65ad',
  statusAssistant: '\u5df2\u5b8c\u6210',
  coverageLabel: '\u53c2\u6570\u8986\u76d6\u7387',
  draftPlaceholder: '\u6dfb\u52a0\u65b0\u7684\u7ea6\u675f\u6216\u8bf4\u660e......',
  staleBase:
    '\u57fa\u7ebf\u53c2\u6570\u7248\u672c\u5df2\u7ecf\u8fc7\u671f\uff0c\u8bf7\u5148\u5237\u65b0\u4f1a\u8bdd\uff0c\u518d\u91cd\u8bd5\u751f\u6210\u7b56\u7565\u3002',
  emptyGroup: '\u5f53\u524d\u7ec4\u8fd8\u6ca1\u6709\u53ef\u7f16\u8f91\u5b57\u6bb5\u3002',
} as const;

const GROUPS: Record<GroupId, GroupConfig> = {
  basic: { id: 'basic', title: TEXT.basic, bucket: 'core' },
  selection: { id: 'selection', title: TEXT.selection, bucket: 'logic' },
  risk: { id: 'risk', title: TEXT.risk, bucket: 'logic' },
  other: { id: 'other', title: TEXT.other, bucket: 'parameters' },
};

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

function classifyField(key: string, label: string, isTopLevel: boolean): GroupConfig {
  if (isTopLevel) {
    return GROUPS.basic;
  }

  const haystack = `${key} ${label}`.toLowerCase();
  if (/(universe|capital|benchmark|objective|name|ticker|stock|symbol)/.test(haystack)) {
    return GROUPS.basic;
  }
  if (/(threshold|window|lookback|logic|entry|exit|target|mean|grid|ma|top|signal|bound)/.test(haystack)) {
    return GROUPS.selection;
  }
  if (/(risk|drawdown|stop|max|rebalance|weight|turnover|volatility|budget)/.test(haystack)) {
    return GROUPS.risk;
  }
  return GROUPS.other;
}

function sourceLabel(source: string): string {
  if (source === 'manual') {
    return TEXT.statusManual;
  }
  if (source === 'system') {
    return TEXT.statusSystem;
  }
  return TEXT.statusAssistant;
}

function KeyValue({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="kv-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function CreationSessionPageCn({ sessionId }: { sessionId: string }): JSX.Element {
  const api = useApiClient();
  const [session, setSession] = useState<ApiStrategyCreationSession | null>(null);
  const [draft, setDraft] = useState<string>(TEXT.defaultDraft);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editableFields, setEditableFields] = useState<Record<string, string>>({});

  const groupedFields = useMemo(() => {
    if (!session?.confirmation_fields) {
      return [] as GroupedField[];
    }

    const topLevel = session.confirmation_fields.top_level ?? [];
    const parameters = session.confirmation_fields.parameters ?? [];

    return [
      ...topLevel.map(
        (field) =>
          ({
            ...field,
            ...classifyField(field.key, field.label, true),
          }) satisfies GroupedField,
      ),
      ...parameters.map(
        (field) =>
          ({
            ...field,
            ...classifyField(field.key, field.label, false),
          }) satisfies GroupedField,
      ),
    ];
  }, [session]);

  const canPatchConfirmation = session?.revision !== undefined && groupedFields.length > 0;
  const coverageRatio = useMemo(() => {
    if (groupedFields.length === 0) {
      return '0%';
    }
    const filled = groupedFields.filter((field) => {
      const nextValue = editableFields[field.key] ?? normalizeFieldValue(field.value);
      return nextValue.trim().length > 0;
    }).length;
    return `${Math.round((filled / groupedFields.length) * 100)}% (${filled}/${groupedFields.length})`;
  }, [editableFields, groupedFields]);

  const helperCopy = useMemo(() => {
    if (!session) {
      return TEXT.loadingCopy;
    }
    if (error) {
      return error;
    }
    if (session.pending_inputs?.length) {
      return TEXT.pendingNeedsInput;
    }
    return TEXT.readyCopy;
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
          setEditableFields(
            Object.fromEntries(
              [
                ...(nextSession.confirmation_fields?.top_level ?? []),
                ...(nextSession.confirmation_fields?.parameters ?? []),
              ].map((field) => [field.key, normalizeFieldValue(field.value)]),
            ),
          );
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
      setError('\u8bf7\u5148\u8f93\u5165\u4e00\u6761\u6d88\u606f\u518d\u53d1\u9001\u3002');
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
      setEditableFields((current) => ({
        ...current,
        ...Object.fromEntries(
          [
            ...(updated.confirmation_fields?.top_level ?? []),
            ...(updated.confirmation_fields?.parameters ?? []),
          ].map((field) => [field.key, normalizeFieldValue(field.value)]),
        ),
      }));
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function patchConfirmation(): Promise<void> {
    if (!session?.revision) {
      setError('\u8bf7\u5148\u6253\u5f00\u786e\u8ba4\u7a3f\uff0c\u518d\u8fdb\u884c\u624b\u52a8\u4fee\u6539\u3002');
      return;
    }

    const payload: ApiConfirmationUpdateRequest = {
      revision: session.revision,
      core: {},
      logic: {},
      parameters: {},
    };

    groupedFields.forEach((field) => {
      const value = toParameterValue(editableFields[field.key] ?? normalizeFieldValue(field.value));
      if (field.bucket === 'core') {
        payload.core![field.key] = value;
        return;
      }
      if (field.bucket === 'logic') {
        payload.logic![field.key] = value;
        return;
      }
      payload.parameters![field.key] = value;
    });

    try {
      setBusy(true);
      setError(null);
      const updated = await api.updateConfirmation(session.id, payload);
      setSession(updated);
    } catch (caught) {
      setError((caught as ApiError).message);
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
      setError(errorValue.code === 'stale_base_parameter_version' ? TEXT.staleBase : errorValue.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="panel creation-session-page">
        <div className="panel-header">
          <h2>{TEXT.loadingTitle}</h2>
        </div>
        <p className="hero-copy">
          {TEXT.loadingCopy} {sessionId}...
        </p>
      </section>
    );
  }

  const groupedBySection = (id: GroupId) => groupedFields.filter((field) => field.id === id);

  return (
    <div className="stack creation-shell creation-session-page">
      <section className="panel creation-hero">
        <div className="creation-hero__copy">
          <p className="eyebrow">{TEXT.loadingTitle}</p>
          <h2>{session?.top_level?.strategy_type ?? TEXT.loadingTitle}</h2>
          <p className="hero-copy">{helperCopy}</p>
        </div>
        <div className="hero-actions">
          <button className="ghost-button" onClick={() => navigateTo('/workspace')} type="button">
            {TEXT.backToWorkspace}
          </button>
          <button className="primary-button" disabled={busy || !session} onClick={() => void materialize()} type="button">
            {TEXT.materialize}
          </button>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="creation-session-grid">
        <section className="panel creation-session-main">
          <div className="panel-header">
            <div>
              <h3>{TEXT.chatTitle}</h3>
              <p className="hero-copy creation-panel-copy">{TEXT.chatCopy}</p>
            </div>
            <span className="status-chip">{session?.status ?? 'BOOTSTRAPPING'}</span>
          </div>

          <div className="creation-message-list">
            {session?.messages?.length ? (
              session.messages.map((message, index) => (
                <article
                  className={`creation-message-card creation-message-card--${message.role === 'user' ? 'user' : 'system'}`}
                  key={`${message.role ?? 'message'}-${index}`}
                >
                  <strong>{message.role === 'user' ? '\u7528\u6237' : '\u7cfb\u7edf'}</strong>
                  <p>{message.content}</p>
                  <small>{message.created_at ?? '\u5f85\u540e\u7aef\u786e\u8ba4'}</small>
                </article>
              ))
            ) : (
              <p className="empty-state">{TEXT.noMessages}</p>
            )}
          </div>

          <div className="creation-composer">
            <div className="panel-header">
              <h3>{TEXT.composerTitle}</h3>
              <span className="status-chip">{TEXT.coverageLabel} {coverageRatio}</span>
            </div>
            <textarea
              aria-label={TEXT.promptLabel}
              className="prompt-box"
              onChange={(event) => setDraft(event.target.value)}
              placeholder={TEXT.draftPlaceholder}
              value={draft}
            />
            <div className="hero-actions">
              <button className="primary-button" disabled={busy || !session} onClick={() => void sendPrompt()} type="button">
                {TEXT.sendMessage}
              </button>
              <button className="ghost-button" disabled={busy || !session} onClick={() => void prepareConfirmation()} type="button">
                {TEXT.prepare}
              </button>
              <button className="ghost-button" disabled={busy || !canPatchConfirmation} onClick={() => void patchConfirmation()} type="button">
                {TEXT.applyDraft}
              </button>
            </div>
          </div>
        </section>

        <aside className="creation-session-sidebar">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>{TEXT.formTitle}</h3>
                <p className="hero-copy creation-panel-copy">{TEXT.formCopy}</p>
              </div>
            </div>

            <div className="creation-group-switches">
              {(['basic', 'selection', 'risk', 'other'] as GroupId[]).map((groupId) => (
                <span className="status-chip" key={groupId}>
                  {GROUPS[groupId].title}
                </span>
              ))}
            </div>

            <div className="creation-form-groups">
              {(['basic', 'selection', 'risk', 'other'] as GroupId[]).map((groupId) => {
                const fields = groupedBySection(groupId);
                return (
                  <section className="creation-form-group" key={groupId}>
                    <div className="panel-header">
                      <h3>{GROUPS[groupId].title}</h3>
                    </div>
                    {fields.length ? (
                      <div className="parameter-list">
                        {fields.map((field) => (
                          <div className="parameter-row creation-parameter-row" key={field.key}>
                            <div>
                              <span>{field.label}</span>
                              <small>{field.key}</small>
                            </div>
                            <label>
                              <span className="sr-only">{field.label}</span>
                              <input
                                aria-label={field.label}
                                className="creation-inline-input"
                                disabled={busy}
                                onChange={(event) =>
                                  setEditableFields((current) => ({
                                    ...current,
                                    [field.key]: event.target.value,
                                  }))
                                }
                                type="text"
                                value={editableFields[field.key] ?? normalizeFieldValue(field.value)}
                              />
                            </label>
                            <small>{sourceLabel(field.source)}</small>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="empty-state">{TEXT.emptyGroup}</p>
                    )}
                  </section>
                );
              })}
            </div>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>{TEXT.topLevelTitle}</h3>
            </div>
            {session?.top_level ? (
              <div className="kv-grid">
                <KeyValue label="\u7b56\u7565\u7c7b\u578b" value={session.top_level.strategy_type ?? '-'} />
                <KeyValue label="\u80a1\u7968\u6c60" value={session.top_level.universe_name ?? '-'} />
                <KeyValue label="\u518d\u5e73\u8861" value={session.top_level.rebalance_frequency ?? '-'} />
              </div>
            ) : (
              <p className="empty-state">{TEXT.topLevelEmpty}</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>{TEXT.pendingTitle}</h3>
            </div>
            {session?.pending_inputs?.length ? (
              <div className="parameter-list">
                {session.pending_inputs.map((item) => (
                  <div className="parameter-row creation-parameter-row" key={item.key}>
                    <div>
                      <span>{item.label}</span>
                      <small>{item.key}</small>
                    </div>
                    <strong>{TEXT.pendingTitle}</strong>
                    <small>{item.message}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">{TEXT.pendingEmpty}</p>
            )}
          </section>

          <section className="panel">
            <div className="panel-header">
              <h3>{TEXT.conflictsTitle}</h3>
            </div>
            {session?.manual_conflicts?.length ? (
              <div className="parameter-list">
                {session.manual_conflicts.map((conflict) => (
                  <div className="parameter-row creation-parameter-row" key={conflict.key}>
                    <div>
                      <span>{conflict.label}</span>
                      <small>{conflict.key}</small>
                    </div>
                    <strong>
                      {conflict.suggested_value === undefined ? '-' : String(conflict.suggested_value)}
                    </strong>
                    <small>{conflict.message}</small>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-state">{TEXT.conflictsEmpty}</p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

export { CreationSessionPageCn as CreationSessionPage };

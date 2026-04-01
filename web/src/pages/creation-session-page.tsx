import { useEffect, useMemo, useRef, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import {
  ApiError,
  type ApiConfirmationUpdateRequest,
  type ApiStrategyCreationSession,
  type ParameterValue,
  type StrategyType,
} from '../types';
import './creation-backtest.css';

type StepKey = 'basic' | 'selection' | 'risk' | 'other';
type FieldBucket = 'core' | 'logic' | 'parameters';
type SaveState = 'synced' | 'unsaved' | 'saving' | 'error';

type EditableField = {
  key: string;
  label: string;
  source: string;
  value: unknown;
  bucket: FieldBucket;
  step: StepKey;
  isTopLevel: boolean;
};

type ReminderChip = {
  id: string;
  key: string;
  label: string;
  message: string;
  step: StepKey;
  tone: 'warning' | 'info';
};

type StepViewModel = {
  key: StepKey;
  title: string;
  description: string;
  fields: EditableField[];
  reminders: ReminderChip[];
  filledCount: number;
  totalFields: number;
  isComplete: boolean;
};

const TEXT = {
  eyebrow: '策略创建',
  loadingTitle: '策略创建',
  loadingCopy: '正在从后端加载策略草稿。',
  defaultDraft: '',
  errorFallback: '页面加载失败，请稍后重试。',
  titleCopy: '左侧对话持续澄清策略意图，右侧按步骤补齐和覆盖关键参数。',
  backToWorkspace: '返回工作台',
  sendMessage: '发送消息',
  openConfirmation: '打开确认稿',
  prepare: '生成确认稿',
  materialize: '生成策略',
  chatTitle: '对话',
  chatCopy: '',
  chatPromptCard: '请说明你策略的交易逻辑、关键参数阈值。',
  formTitle: '动态表单控制台',
  formCopy: '左侧对话提取参数，右侧按步骤补齐与覆盖。',
  promptLabel: '消息',
  promptPlaceholder: '请说明...',
  stepBasic: '基础配置',
  stepSelection: '选股规则',
  stepRisk: '风控 / 再平衡',
  stepOther: '其他参数',
  stepBasicCopy: '名称、目标、股票池、基准类信息。',
  stepSelectionCopy: '阈值、窗口、均值回归 / 网格 / 动量规则。',
  stepRiskCopy: '风险预算、止损、仓位与再平衡设置。',
  stepOtherCopy: '未归类字段与剩余补充项。',
  stepComplete: '已完成',
  stepPending: '待处理',
  stepEmpty: '当前步骤暂时没有可编辑字段。',
  stepReminders: '需要处理的提醒',
  saveSynced: '已同步',
  saveUnsaved: '待同步',
  saveSaving: '保存中',
  saveError: '保存失败',
  saveErrorBanner: '保存失败，请重试',
  reminderNeedsInput: '草稿需要补充信息',
  reminderSynced: '草稿已同步',
  reminderSaving: '正在同步草稿',
  reminderUnsaved: '存在未同步改动',
  reminderPendingSuffix: '待补充',
  reminderConflictSuffix: '待处理',
  coverageLabel: '当前参数覆盖率',
  stepSummaryLabel: '步骤完成度',
  roleSystem: '系统',
  roleUser: '用户',
  roleAssistant: '助手',
  staleBase:
    '基线参数版本已经过期，请先刷新会话或重新打开确认稿，再继续生成策略。',
} as const;

const STEP_ORDER: StepKey[] = ['basic', 'selection', 'risk', 'other'];

const STEP_META: Record<
  StepKey,
  { title: string; description: string }
> = {
  basic: { title: TEXT.stepBasic, description: TEXT.stepBasicCopy },
  selection: { title: TEXT.stepSelection, description: TEXT.stepSelectionCopy },
  risk: { title: TEXT.stepRisk, description: TEXT.stepRiskCopy },
  other: { title: TEXT.stepOther, description: TEXT.stepOtherCopy },
};

const STRATEGY_LABELS: Record<StrategyType, string> = {
  GENERAL: '通用',
  GRID: '网格交易',
  MOMENTUM: '动量 / 趋势跟随',
  MEAN_REVERSION: '均值回归',
  BUY_AND_HOLD: '指数 / 定投',
};

function normalizeFieldValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value);
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase();
}

function isFilled(value: string): boolean {
  return value.trim().length > 0;
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

function strategyTypeLabel(strategyType?: StrategyType | null): string {
  if (!strategyType) {
    return '策略';
  }
  return STRATEGY_LABELS[strategyType] ?? '策略';
}

function deriveStrategyTitle(session: ApiStrategyCreationSession | null): string {
  if (!session) {
    return TEXT.loadingTitle;
  }

  const candidateFields = [
    ...(session.confirmation_fields?.top_level ?? []),
    ...(session.confirmation_fields?.parameters ?? []),
  ];
  const namedField = candidateFields.find((field) => {
    const normalizedKey = normalizeSearchText(field.key);
    const normalizedLabel = normalizeSearchText(field.label);
    return (
      normalizedKey.includes('strategyname') ||
      normalizedKey === 'name' ||
      normalizedLabel.includes('策略名称') ||
      normalizedLabel.includes('名称')
    );
  });

  const namedValue = normalizeFieldValue(namedField?.value).trim();
  if (namedValue) {
    return namedValue;
  }

  const universeName = normalizeFieldValue(session.top_level?.universe_name).trim();
  const typeLabel = strategyTypeLabel(session.top_level?.strategy_type ?? undefined);
  if (universeName) {
    return `${universeName} ${typeLabel}策略`;
  }
  if (session.top_level?.strategy_type) {
    return `${typeLabel}策略`;
  }
  return TEXT.loadingTitle;
}

function classifyStep(key: string, label: string, isTopLevel: boolean): StepKey {
  if (isTopLevel) {
    return 'basic';
  }

  const haystack = normalizeSearchText(`${key} ${label}`);
  if (
    /(name|universe|benchmark|objective|symbol|ticker|stock|target|pool)/.test(haystack) ||
    /(名称|股票池|标的|基准|目标|范围)/.test(haystack)
  ) {
    return 'basic';
  }
  if (
    /(threshold|window|lookback|entry|exit|mean|grid|ma|signal|logic|bound|rule|alpha|beta)/.test(
      haystack,
    ) ||
    /(阈值|窗口|回看|均值|网格|均线|信号|逻辑|规则|选股|因子)/.test(haystack)
  ) {
    return 'selection';
  }
  if (
    /(risk|drawdown|stop|max|rebalance|weight|turnover|volatility|budget|loss|position)/.test(
      haystack,
    ) ||
    /(风险|回撤|止损|再平衡|仓位|权重|波动|预算|损失)/.test(haystack)
  ) {
    return 'risk';
  }
  return 'other';
}

function bucketForField(step: StepKey, isTopLevel: boolean): FieldBucket {
  if (isTopLevel) {
    return 'core';
  }
  if (step === 'selection' || step === 'risk') {
    return 'logic';
  }
  return 'parameters';
}

function collectEditableFields(session: ApiStrategyCreationSession | null): EditableField[] {
  if (!session?.confirmation_fields) {
    return [];
  }

  const topLevelFields = (session.confirmation_fields.top_level ?? []).map((field) => {
    const step = classifyStep(field.key, field.label, true);
    return {
      key: field.key,
      label: field.label,
      source: field.source,
      value: field.value,
      isTopLevel: true,
      step,
      bucket: bucketForField(step, true),
    } satisfies EditableField;
  });

  const parameterFields = (session.confirmation_fields.parameters ?? []).map((field) => {
    const step = classifyStep(field.key, field.label, false);
    return {
      key: field.key,
      label: field.label,
      source: field.source,
      value: field.value,
      isTopLevel: false,
      step,
      bucket: bucketForField(step, false),
    } satisfies EditableField;
  });

  return [...topLevelFields, ...parameterFields];
}

function buildValueMap(fields: EditableField[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, normalizeFieldValue(field.value)]));
}

function buildReminderChips(session: ApiStrategyCreationSession | null): ReminderChip[] {
  if (!session) {
    return [];
  }

  const pending = (session.pending_inputs ?? []).map((item) => ({
    id: `pending-${item.key}`,
    key: item.key,
    label: item.label,
    message: item.message,
    step: classifyStep(item.key, item.label, false),
    tone: 'warning' as const,
  }));

  const conflicts = (session.manual_conflicts ?? []).map((item) => ({
    id: `conflict-${item.key}`,
    key: item.key,
    label: item.label,
    message: item.message,
    step: classifyStep(item.key, item.label, false),
    tone: 'warning' as const,
  }));

  return [...pending, ...conflicts];
}

function buildStepViewModels(
  fields: EditableField[],
  values: Record<string, string>,
  reminders: ReminderChip[],
): StepViewModel[] {
  return STEP_ORDER.map((step) => {
    const stepFields = fields.filter((field) => field.step === step);
    const stepReminders = reminders.filter((reminder) => reminder.step === step);
    const filledCount = stepFields.filter((field) => isFilled(values[field.key] ?? '')).length;
    const isComplete =
      stepReminders.length === 0 &&
      (stepFields.length === 0 || filledCount === stepFields.length);

    return {
      key: step,
      title: STEP_META[step].title,
      description: STEP_META[step].description,
      fields: stepFields,
      reminders: stepReminders,
      filledCount,
      totalFields: stepFields.length,
      isComplete,
    };
  });
}

function sourceLabel(source: string): string {
  if (source === 'manual') {
    return '人工修正';
  }
  if (source === 'system') {
    return '系统推断';
  }
  return '已同步';
}

function roleLabel(role?: string | null): string {
  if (role === 'user') {
    return TEXT.roleUser;
  }
  if (role === 'assistant') {
    return TEXT.roleAssistant;
  }
  return TEXT.roleSystem;
}

function parseConversationTimestamp(value?: string | null): Date | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T');
  const withTimezone =
    /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}+08:00`;
  const parsed = new Date(withTimezone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatConversationTimestamp(value?: string | null): string {
  const parsed = parseConversationTimestamp(value);
  if (!parsed) {
    return value?.trim() ?? '';
  }

  const formatter = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Hong_Kong',
  });
  const parts = formatter.formatToParts(parsed);
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  const month = lookup('month');
  const day = lookup('day');
  const dayPeriod = lookup('dayPeriod');
  const hour = lookup('hour');
  const minute = lookup('minute');

  if (month && day && hour && minute) {
    return `${month}月${day}日 ${dayPeriod}${hour}:${minute}`;
  }

  return formatter.format(parsed);
}

function isLongFormField(field: EditableField): boolean {
  const haystack = normalizeSearchText(`${field.key} ${field.label}`);
  return /(note|description|objective|goal|prompt|comment|explain|memo)/.test(haystack) || /(说明|备注|目标|描述)/.test(haystack);
}

function firstIncompleteStep(stepViews: StepViewModel[]): StepKey {
  return stepViews.find((step) => !step.isComplete)?.key ?? 'basic';
}

function buildPayload(
  fields: EditableField[],
  values: Record<string, string>,
  revision: number,
): ApiConfirmationUpdateRequest {
  const payload: ApiConfirmationUpdateRequest = {
    revision,
    core: {},
    logic: {},
    parameters: {},
  };

  fields.forEach((field) => {
    const value = toParameterValue(values[field.key] ?? '');
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

  return payload;
}

function sameValues(
  fields: EditableField[],
  left: Record<string, string>,
  right: Record<string, string>,
): boolean {
  return fields.every((field) => (left[field.key] ?? '') === (right[field.key] ?? ''));
}

export function CreationSessionPage({ sessionId }: { sessionId: string }): JSX.Element {
  const api = useApiClient();
  const [session, setSession] = useState<ApiStrategyCreationSession | null>(null);
  const [draft, setDraft] = useState(TEXT.defaultDraft);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('synced');
  const [editableValues, setEditableValues] = useState<Record<string, string>>({});
  const [syncedValues, setSyncedValues] = useState<Record<string, string>>({});
  const [activeStep, setActiveStep] = useState<StepKey>('basic');

  const sessionRef = useRef<ApiStrategyCreationSession | null>(null);
  const editableValuesRef = useRef<Record<string, string>>({});
  const syncedValuesRef = useRef<Record<string, string>>({});
  const savePromiseRef = useRef<Promise<ApiStrategyCreationSession | null> | null>(null);

  const editableFields = useMemo(() => collectEditableFields(session), [session]);
  const reminderChips = useMemo(() => buildReminderChips(session), [session]);
  const stepViews = useMemo(
    () => buildStepViewModels(editableFields, editableValues, reminderChips),
    [editableFields, editableValues, reminderChips],
  );
  const derivedTitle = useMemo(() => deriveStrategyTitle(session), [session]);
  const activeStepView =
    stepViews.find((step) => step.key === activeStep) ??
    stepViews.find((step) => step.key === firstIncompleteStep(stepViews)) ??
    stepViews[0];
  const hasUnsavedChanges = useMemo(
    () => !sameValues(editableFields, editableValues, syncedValues),
    [editableFields, editableValues, syncedValues],
  );
  const filledCount = editableFields.filter((field) => isFilled(editableValues[field.key] ?? '')).length;
  const coverageRatio = editableFields.length
    ? Math.round((filledCount / editableFields.length) * 100)
    : 100;
  const completedStepCount = stepViews.filter((step) => step.isComplete).length;
  const allStepsComplete = stepViews.every((step) => step.isComplete);
  const canMaterialize =
    Boolean(session?.revision) &&
    allStepsComplete &&
    !hasUnsavedChanges &&
    saveState === 'synced';
  const primaryActionLabel = canMaterialize ? TEXT.materialize : TEXT.prepare;
  const guidanceTimestamp = formatConversationTimestamp(
    session?.messages?.find((message) => message.created_at)?.created_at ?? new Date().toISOString(),
  );

  function syncState(
    nextSession: ApiStrategyCreationSession,
    options?: { preserveActiveStep?: boolean },
  ): void {
    const nextFields = collectEditableFields(nextSession);
    const nextValues = buildValueMap(nextFields);
    const nextReminderChips = buildReminderChips(nextSession);
    const nextStepViews = buildStepViewModels(nextFields, nextValues, nextReminderChips);

    sessionRef.current = nextSession;
    editableValuesRef.current = nextValues;
    syncedValuesRef.current = nextValues;

    setSession(nextSession);
    setEditableValues(nextValues);
    setSyncedValues(nextValues);
    setSaveState('synced');
    setSaveError(null);
    setActiveStep((current) => {
      if (options?.preserveActiveStep && STEP_ORDER.includes(current)) {
        return current;
      }
      return firstIncompleteStep(nextStepViews);
    });
  }

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setError(null);
        const nextSession = await api.getCreationSession(sessionId);
        if (!cancelled) {
          syncState(nextSession);
        }
      } catch (caught) {
        if (!cancelled) {
          const message = caught instanceof Error ? caught.message : TEXT.errorFallback;
          setError(message);
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

  async function persistEditsIfNeeded(): Promise<ApiStrategyCreationSession | null> {
    if (savePromiseRef.current) {
      return savePromiseRef.current;
    }

    const currentSession = sessionRef.current;
    if (!currentSession) {
      return null;
    }

    const currentFields = collectEditableFields(currentSession);
    const currentValues = editableValuesRef.current;
    const currentSyncedValues = syncedValuesRef.current;
    const needsSave = !sameValues(currentFields, currentValues, currentSyncedValues);
    if (!needsSave) {
      return currentSession;
    }
    if (typeof currentSession.revision !== 'number') {
      setSaveState('error');
      setSaveError(TEXT.saveErrorBanner);
      return null;
    }

    setSaveState('saving');
    setSaveError(null);

    const savePromise = (async () => {
      try {
        const payload = buildPayload(currentFields, currentValues, currentSession.revision);
        const updated = await api.updateConfirmation(currentSession.id, payload);
        syncState(updated, { preserveActiveStep: true });
        return updated;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : TEXT.saveErrorBanner;
        setSaveState('error');
        setSaveError(message);
        return null;
      } finally {
        savePromiseRef.current = null;
      }
    })();

    savePromiseRef.current = savePromise;
    return savePromise;
  }

  async function sendPrompt(): Promise<void> {
    if (!draft.trim()) {
      setError('请先输入一条消息再发送。');
      return;
    }
    if (!sessionRef.current) {
      return;
    }

    try {
      setBusyAction(true);
      setError(null);
      const updated = await api.appendCreationMessage(
        sessionRef.current.id,
        draft.trim(),
        sessionRef.current.revision,
      );
      syncState(updated, { preserveActiveStep: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : TEXT.errorFallback);
    } finally {
      setBusyAction(false);
    }
  }

  async function openConfirmation(): Promise<void> {
    const currentSession = await persistEditsIfNeeded();
    if (!currentSession) {
      return;
    }

    try {
      setBusyAction(true);
      setError(null);
      const updated = await api.prepareConfirmation(currentSession.id);
      syncState(updated, { preserveActiveStep: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : TEXT.errorFallback);
    } finally {
      setBusyAction(false);
    }
  }

  async function materialize(sessionToUse: ApiStrategyCreationSession): Promise<void> {
    try {
      setBusyAction(true);
      setError(null);
      const strategy = await api.materializeStrategy(
        sessionToUse.id,
        `materialize-${sessionToUse.id}`,
        sessionToUse.revision,
      );
      navigateTo(`/strategies/${strategy.id}/backtest-runs/new`);
    } catch (caught) {
      const errorValue = caught as ApiError;
      setError(
        errorValue?.code === 'stale_base_parameter_version'
          ? TEXT.staleBase
          : errorValue?.message ?? TEXT.errorFallback,
      );
    } finally {
      setBusyAction(false);
    }
  }

  async function handlePrimaryAction(): Promise<void> {
    const currentSession = await persistEditsIfNeeded();
    if (!currentSession) {
      return;
    }

    const latestFields = collectEditableFields(currentSession);
    const latestValues = buildValueMap(latestFields);
    const latestReminders = buildReminderChips(currentSession);
    const latestSteps = buildStepViewModels(latestFields, latestValues, latestReminders);
    const readyForMaterialize =
      Boolean(currentSession.revision) && latestSteps.every((step) => step.isComplete);

    if (readyForMaterialize) {
      await materialize(currentSession);
      return;
    }

    try {
      setBusyAction(true);
      setError(null);
      const updated = await api.prepareConfirmation(currentSession.id);
      syncState(updated, { preserveActiveStep: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : TEXT.errorFallback);
    } finally {
      setBusyAction(false);
    }
  }

  async function handleStepChange(step: StepKey): Promise<void> {
    if (step === activeStep) {
      return;
    }
    const persisted = await persistEditsIfNeeded();
    if (hasUnsavedChanges && !persisted) {
      return;
    }
    setActiveStep(step);
  }

  function handleFieldChange(key: string, nextValue: string): void {
    editableValuesRef.current = {
      ...editableValuesRef.current,
      [key]: nextValue,
    };
    setEditableValues(editableValuesRef.current);
    setSaveState('unsaved');
    setSaveError(null);
  }

  if (loading) {
    return (
      <section className="panel creation-session-page">
        <div className="panel-header">
          <h2>{TEXT.loadingTitle}</h2>
        </div>
        <p className="hero-copy">{TEXT.loadingCopy}</p>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="panel creation-session-page">
        <div className="error-banner">{error ?? TEXT.errorFallback}</div>
      </section>
    );
  }

  return (
    <div className="stack creation-shell creation-session-page">
      <section className="creation-title-card">
        <div className="creation-title-card__copy">
          <p className="eyebrow">{TEXT.eyebrow}</p>
          <h1 className="creation-title-card__title">{derivedTitle}</h1>
          <p className="hero-copy">{TEXT.titleCopy}</p>
        </div>
        <div className="creation-session-hero__actions">
          <button className="ghost-button" onClick={() => navigateTo('/workspace')} type="button">
            {TEXT.backToWorkspace}
          </button>
          <button
            className="primary-button"
            disabled={busyAction || saveState === 'saving'}
            onClick={() => void handlePrimaryAction()}
            type="button"
          >
            {primaryActionLabel}
          </button>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <div className="creation-session-grid">
        <section className="panel creation-session-main">
          <div className="panel-header">
            <div>
              <h3>{TEXT.chatTitle}</h3>
              {TEXT.chatCopy ? (
                <p className="hero-copy creation-panel-copy">{TEXT.chatCopy}</p>
              ) : null}
            </div>
          </div>

          <div className="creation-message-list">
            <article className="creation-message-card creation-message-card--system">
              <strong>{TEXT.roleSystem}</strong>
              <p>{TEXT.chatPromptCard}</p>
              <small>{guidanceTimestamp}</small>
            </article>

            {session.messages?.length
              ? session.messages.map((message, index) => {
                const role = message.role === 'user' ? 'user' : 'system';
                return (
                  <article
                    className={`creation-message-card creation-message-card--${role}`}
                    key={`${message.role ?? 'message'}-${index}`}
                  >
                    <strong>{roleLabel(message.role)}</strong>
                    <p>{message.content}</p>
                    <small>{formatConversationTimestamp(message.created_at) || '待后端确认'}</small>
                  </article>
                );
              })
              : null}
          </div>

          <div className="creation-composer">
            <div className="panel-header">
              <h3>{TEXT.promptLabel}</h3>
            </div>
            <textarea
              aria-label={TEXT.promptLabel}
              className="prompt-box"
              disabled={busyAction}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={TEXT.promptPlaceholder}
              value={draft}
            />
            <div className="hero-actions creation-form-actions">
              <button
                className="primary-button"
                disabled={busyAction || saveState === 'saving'}
                onClick={() => void sendPrompt()}
                type="button"
              >
                {TEXT.sendMessage}
              </button>
              <button
                className="ghost-button"
                disabled={busyAction || saveState === 'saving'}
                onClick={() => void openConfirmation()}
                type="button"
              >
                {TEXT.openConfirmation}
              </button>
            </div>
          </div>
        </section>

        <aside className="creation-session-sidebar">
          <section className="panel creation-step-card creation-step-card--active">
            <div className="creation-step-card__header">
              <div>
                <h3 className="creation-step-card__title">{TEXT.formTitle}</h3>
                <p className="creation-step-card__copy">{TEXT.formCopy}</p>
              </div>
            </div>

            <div className="creation-step-chip-row">
              {stepViews.map((step) => {
                const toneClass = step.key === activeStep
                  ? 'creation-step-chip--active'
                  : step.isComplete
                    ? 'creation-step-chip--success'
                    : 'creation-step-chip--warning';
                return (
                  <button
                    className={`creation-step-chip ${toneClass}`}
                    key={step.key}
                    onClick={() => void handleStepChange(step.key)}
                    type="button"
                  >
                    <span>{step.title}</span>
                    <span>{step.isComplete ? TEXT.stepComplete : TEXT.stepPending}</span>
                  </button>
                );
              })}
            </div>

            {activeStepView ? (
              <div className="creation-step-panel">
                <div className="creation-step-panel__header">
                  <div>
                    <h4 className="creation-step-card__title">{activeStepView.title}</h4>
                    <p className="creation-step-card__copy">{activeStepView.description}</p>
                  </div>
                  <span
                    className={`creation-save-status ${
                      activeStepView.isComplete
                        ? 'creation-save-status--saving'
                        : 'creation-save-status--unsaved'
                    }`}
                  >
                    {activeStepView.isComplete ? TEXT.stepComplete : TEXT.stepPending}
                  </span>
                </div>

                {activeStepView.reminders.length ? (
                  <div className="creation-warning-chips" aria-label={TEXT.stepReminders}>
                    {activeStepView.reminders.map((reminder) => (
                      <span
                        className={`creation-warning-chip creation-warning-chip--${reminder.tone}`}
                        key={reminder.id}
                        title={reminder.message}
                      >
                        {reminder.label}
                      </span>
                    ))}
                  </div>
                ) : null}

                <div className="creation-step-card__body">
                  {activeStepView.fields.length ? (
                    activeStepView.fields.map((field) => {
                      const fieldValue = editableValues[field.key] ?? '';
                      const multiline = isLongFormField(field);
                      return (
                        <label className="creation-form-group" key={field.key}>
                          <div className="creation-step-card__header">
                            <div>
                              <h4>{field.label}</h4>
                              <p className="creation-step-card__copy">{field.key}</p>
                            </div>
                            <span className="status-chip">{sourceLabel(field.source)}</span>
                          </div>
                          {multiline ? (
                            <textarea
                              aria-label={field.label}
                              className="creation-inline-input"
                              disabled={busyAction || saveState === 'saving'}
                              onBlur={() => void persistEditsIfNeeded()}
                              onChange={(event) => handleFieldChange(field.key, event.target.value)}
                              rows={4}
                              value={fieldValue}
                            />
                          ) : (
                            <input
                              aria-label={field.label}
                              className="creation-inline-input"
                              disabled={busyAction || saveState === 'saving'}
                              onBlur={() => void persistEditsIfNeeded()}
                              onChange={(event) => handleFieldChange(field.key, event.target.value)}
                              type="text"
                              value={fieldValue}
                            />
                          )}
                        </label>
                      );
                    })
                  ) : (
                    <p className="creation-step-card__empty">{TEXT.stepEmpty}</p>
                  )}
                </div>

                <div className="creation-save-bar">
                  <span
                    className={`creation-save-status ${
                      saveState === 'saving'
                        ? 'creation-save-status--saving'
                        : saveState === 'unsaved'
                          ? 'creation-save-status--unsaved'
                          : saveState === 'error'
                            ? 'creation-save-status--error'
                            : 'creation-step-chip--success'
                    }`}
                  >
                    {saveState === 'saving'
                      ? TEXT.saveSaving
                      : saveState === 'unsaved'
                        ? TEXT.saveUnsaved
                        : saveState === 'error'
                          ? TEXT.saveError
                          : TEXT.saveSynced}
                  </span>
                  <span className="creation-step-card__copy">
                    {TEXT.coverageLabel} {coverageRatio}% ({filledCount}/{editableFields.length || 0})
                  </span>
                  <span className="creation-step-card__copy">
                    {TEXT.stepSummaryLabel} {completedStepCount}/{stepViews.length}
                  </span>
                </div>
                {saveError ? <div className="error-banner">{saveError}</div> : null}
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}

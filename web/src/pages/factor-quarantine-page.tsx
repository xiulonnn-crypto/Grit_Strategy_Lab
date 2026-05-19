import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApiClient } from '../lib/demoStoreContext';
import { formatDateTime } from '../lib/format';
import type { ApiFactorQuarantineCandidate } from '../types';
import './factor-phase2-pages.css';

const STATUS_LABELS: Record<string, string> = {
  PENDING: '待检疫',
  RUNNING: '检疫中',
  PASSED: '已通过',
  REJECTED: '已拒绝',
  NEEDS_REVIEW: '待复核',
  PUBLISHED: '已发布',
  SUPERSEDED: '已合并',
};

const PUBLISH_LABELS: Record<string, string> = {
  ELIGIBLE: '可发布',
  BLOCKED: '已阻断',
  MANUAL_REVIEW_REQUIRED: '需人工复核',
  PUBLISHED: '已发布',
};

const PIT_LABELS: Record<string, string> = {
  FULL_READY: '完整就绪',
  'FULL READY': '完整就绪',
  LIMITED_READY: '研究就绪',
  'LIMITED READY': '研究就绪',
  READY: '就绪',
  BLOCKED: '阻断',
};

type BusyAction = 'intake' | 'run' | 'publish' | null;
type CandidateRecord = Record<string, unknown>;

function isRecord(value: unknown): value is CandidateRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asRecord(value: unknown): CandidateRecord {
  return isRecord(value) ? value : {};
}

function asRecordList(value: unknown): CandidateRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asText(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

function statusToken(value: unknown): string {
  return asText(value).trim().toUpperCase();
}

function candidateSignature(candidate: ApiFactorQuarantineCandidate): string {
  const expression = String(candidate.expression ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  return expression || String(candidate.id ?? '').trim().toLowerCase();
}

function normalizeCandidate(item: unknown): ApiFactorQuarantineCandidate | null {
  if (!isRecord(item)) return null;
  const id = asText(item.id).trim() || asText(item.mining_candidate_id).trim();
  const expression = asText(item.expression).trim();
  if (!id && !expression) return null;
  const fallbackLabel = expression || id;
  return {
    ...(item as Partial<ApiFactorQuarantineCandidate>),
    id: id || fallbackLabel,
    mining_candidate_id: asText(item.mining_candidate_id) || null,
    source_mining_job_id: asText(item.source_mining_job_id) || null,
    expression: expression || fallbackLabel,
    status: asText(item.status, 'PENDING'),
    publish_status: asText(item.publish_status, 'MANUAL_REVIEW_REQUIRED'),
    gate_summary: asRecord(item.gate_summary),
    cluster_id: asText(item.cluster_id) || null,
    candidate_metrics: asRecord(item.candidate_metrics),
    failure_samples: asRecordList(item.failure_samples),
    pit_evidence: asRecord(item.pit_evidence),
    publish_eligibility: asRecord(item.publish_eligibility),
    target_factor_id: asText(item.target_factor_id) || null,
    publish_naming_rule: asText(item.publish_naming_rule) || null,
    created_at: asText(item.created_at),
    updated_at: asText(item.updated_at),
    published_at: asText(item.published_at) || null,
    rejected_reason: asText(item.rejected_reason) || null,
    latest_run: isRecord(item.latest_run) ? item.latest_run : undefined,
  };
}

function normalizeCandidateQueue(items: unknown): ApiFactorQuarantineCandidate[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const normalized: ApiFactorQuarantineCandidate[] = [];
  for (const item of items) {
    const candidate = normalizeCandidate(item);
    if (!candidate) continue;
    const signature = candidateSignature(candidate);
    if (!signature || seen.has(signature)) continue;
    seen.add(signature);
    normalized.push(candidate);
  }
  return normalized;
}

function pct(value: unknown, digits = 1): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '待生成';
  return `${(numeric > 1 ? numeric : numeric * 100).toFixed(digits)}%`;
}

function num(value: unknown, digits = 3): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : '待生成';
}

function statusLabel(status: string): string {
  return STATUS_LABELS[statusToken(status)] ?? '待检疫';
}

function publishLabel(status: string): string {
  return PUBLISH_LABELS[statusToken(status)] ?? '需复核';
}

function pitLabel(value: unknown): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '待生成';
  return PIT_LABELS[normalized.toUpperCase()] ?? normalized;
}

function chipTone(status: string): string {
  const normalized = statusToken(status);
  if (normalized === 'PASSED' || normalized === 'PUBLISHED' || normalized === 'ELIGIBLE') return 'good';
  if (normalized === 'REJECTED' || normalized === 'BLOCKED') return 'bad';
  return 'warn';
}

function candidateReport(candidate: ApiFactorQuarantineCandidate) {
  return {
    gate: asRecord(candidate.gate_summary),
    metrics: asRecord(candidate.candidate_metrics),
    pit: asRecord(candidate.pit_evidence),
    publish: asRecord(candidate.publish_eligibility),
  };
}

function reportReason(candidate: ApiFactorQuarantineCandidate): string {
  const { gate, publish } = candidateReport(candidate);
  return asText(publish.reason)
    || asText(gate.rejected_reason)
    || '检疫报告已保留门禁摘要、正交化说明和结果附件引用。';
}

function rejectedReason(candidate: ApiFactorQuarantineCandidate): string {
  const { gate } = candidateReport(candidate);
  return asText(candidate.rejected_reason)
    || asText(gate.rejected_reason)
    || '门禁未通过，保留用于后续调参。';
}

function replaceCandidate(
  items: ApiFactorQuarantineCandidate[],
  candidate: ApiFactorQuarantineCandidate,
): ApiFactorQuarantineCandidate[] {
  const normalized = normalizeCandidate(candidate);
  if (!normalized) return items;
  const matched = items.some((item) => item.id === normalized.id);
  if (!matched) return normalizeCandidateQueue([normalized, ...items]);
  return normalizeCandidateQueue(items.map((item) => (item.id === normalized.id ? normalized : item)));
}

export default function FactorQuarantinePage(): JSX.Element {
  const api = useApiClient();
  const [candidates, setCandidates] = useState<ApiFactorQuarantineCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [loading, setLoading] = useState(Boolean(api.listFactorQuarantineCandidates));
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCandidates = useCallback(async (): Promise<void> => {
    if (!api.listFactorQuarantineCandidates) {
      setCandidates([]);
      setSelectedId('');
      setError('检疫候选 API 尚未接入。');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const payload = await api.listFactorQuarantineCandidates();
      const items = normalizeCandidateQueue(payload.items);
      setCandidates(items);
      setSelectedId((current) => (current && items.some((item) => item.id === current) ? current : items[0]?.id ?? ''));
      setError(null);
    } catch (err) {
      setCandidates([]);
      setSelectedId('');
      setError(err instanceof Error ? err.message : '检疫候选加载失败。');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.id === selectedId) ?? candidates[0],
    [candidates, selectedId],
  );
  const selectedReport = selected ? candidateReport(selected) : null;
  const passedCount = candidates.filter((candidate) => ['PASSED', 'PUBLISHED'].includes(statusToken(candidate.status))).length;
  const reviewCount = candidates.filter((candidate) => statusToken(candidate.status) === 'NEEDS_REVIEW').length;
  const rejectedCount = candidates.filter((candidate) => statusToken(candidate.status) === 'REJECTED').length;
  const publishableCandidates = candidates.filter((candidate) => (
    statusToken(candidate.status) === 'PASSED' && statusToken(candidate.publish_status) === 'ELIGIBLE'
  ));
  const latestPublished = candidates.filter((candidate) => statusToken(candidate.status) === 'PUBLISHED' || candidate.published_at);
  const rejectedSamples = candidates.filter((candidate) => statusToken(candidate.status) === 'REJECTED' || candidate.rejected_reason);

  const intakeFromSandbox = async (): Promise<void> => {
    if (!api.factorQuarantineIntake) {
      setError('检疫接收 API 尚未接入。');
      return;
    }
    setBusyAction('intake');
    setError(null);
    setNotice(null);
    try {
      const payload = await api.factorQuarantineIntake({});
      const items = normalizeCandidateQueue(payload.items);
      setCandidates((current) => {
        const merged = [...current];
        for (const item of items) {
          const index = merged.findIndex((candidate) => candidate.id === item.id);
          if (index >= 0) merged[index] = item;
          else merged.unshift(item);
        }
        return normalizeCandidateQueue(merged);
      });
      setSelectedId((current) => (current || items[0]?.id || ''));
      setNotice(items.length ? `已从挖掘沙盒接收 ${items.length} 条候选。` : '挖掘沙盒暂无可接收候选。');
    } catch (err) {
      setError(err instanceof Error ? err.message : '从挖掘沙盒接收候选失败。');
    } finally {
      setBusyAction(null);
    }
  };

  const runnableCandidates = candidates.filter((candidate) => (
    !['PUBLISHED', 'SUPERSEDED'].includes(statusToken(candidate.status))
  ));

  const runPendingCandidates = async (): Promise<void> => {
    const targets = runnableCandidates;
    if (!targets.length) {
      setError('当前没有待检疫候选。');
      return;
    }
    if (!api.runFactorQuarantineCandidate) {
      setError('检疫运行 API 尚未接入。');
      return;
    }
    setBusyAction('run');
    setError(null);
    setNotice(null);
    try {
      const updatedItems: ApiFactorQuarantineCandidate[] = [];
      for (const candidate of targets) {
        const updated = await api.runFactorQuarantineCandidate(candidate.id, { reason: 'workbench_batch' });
        updatedItems.push(updated);
        setCandidates((current) => replaceCandidate(current, updated));
      }
      if (updatedItems[0]) {
        setSelectedId(updatedItems[0].id);
      }
      const passed = updatedItems.filter((item) => statusToken(item.status) === 'PASSED').length;
      const review = updatedItems.filter((item) => statusToken(item.status) === 'NEEDS_REVIEW').length;
      const rejected = updatedItems.filter((item) => statusToken(item.status) === 'REJECTED').length;
      setNotice(`已完成一键检疫 ${updatedItems.length} 条：通过 ${passed}、待复核 ${review}、拒绝 ${rejected}。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '一键检疫失败。');
    } finally {
      setBusyAction(null);
    }
  };

  const publishPassed = async (): Promise<void> => {
    if (!api.publishFactorQuarantineCandidate) {
      setError('自动发布 API 尚未接入。');
      return;
    }
    const targets = selected && statusToken(selected.status) === 'PASSED' && statusToken(selected.publish_status) === 'ELIGIBLE'
      ? [selected]
      : publishableCandidates;
    if (!targets.length) {
      setError('当前没有可自动发布的通过项。');
      return;
    }
    setBusyAction('publish');
    setError(null);
    setNotice(null);
    try {
      let publishedCount = 0;
      for (const candidate of targets) {
        const response = await api.publishFactorQuarantineCandidate(candidate.id, { operator: 'system_rule' });
        setCandidates((current) => replaceCandidate(current, response.candidate));
        setSelectedId(response.candidate.id);
        publishedCount += 1;
      }
      setNotice(`已发布 ${publishedCount} 条通过项，并保留发布审计。`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '自动发布失败。');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <main className="factor-phase2-page factor-quarantine-page" data-page-root="factor-quarantine">
      <section className="factor-phase2-hero">
        <div>
          <p className="factor-phase2-hero__eyebrow">D2 检疫治理</p>
          <h1>检疫工作台</h1>
          <p>所有挖掘候选先进入检疫、去重、正交化和发布审计；只有通过完整就绪、样本外与相关性门禁的候选才能自动发布。</p>
        </div>
        <div className="factor-phase2-actions">
          <button
            className="factor-phase2-button"
            disabled={busyAction !== null}
            type="button"
            onClick={() => void intakeFromSandbox()}
          >
            {busyAction === 'intake' ? '接收中...' : '从沙盒拉入'}
          </button>
          <button
            className="factor-phase2-button"
            disabled={busyAction !== null || runnableCandidates.length === 0}
            type="button"
            onClick={() => void runPendingCandidates()}
          >
            {busyAction === 'run' ? '检疫中...' : '一键检疫'}
          </button>
          <button
            className="factor-phase2-button factor-phase2-button--primary"
            disabled={busyAction !== null || publishableCandidates.length === 0}
            type="button"
            onClick={() => void publishPassed()}
          >
            {busyAction === 'publish' ? '发布中...' : '发布通过项'}
          </button>
        </div>
      </section>

      <section className="factor-phase2-metrics" aria-label="检疫工作台指标">
        <article className="factor-phase2-metric">
          <p className="factor-phase2-metric__label">候选队列</p>
          <p className="factor-phase2-metric__value">{candidates.length}</p>
          <p className="factor-phase2-metric__hint">来自挖掘沙盒的待治理表达式</p>
        </article>
        <article className="factor-phase2-metric">
          <p className="factor-phase2-metric__label">通过检疫</p>
          <p className="factor-phase2-metric__value">{passedCount}</p>
          <p className="factor-phase2-metric__hint">满足 PIT、OOS 和正交化门禁</p>
        </article>
        <article className="factor-phase2-metric">
          <p className="factor-phase2-metric__label">待复核</p>
          <p className="factor-phase2-metric__value">{reviewCount}</p>
          <p className="factor-phase2-metric__hint">研究就绪或研究态豁免</p>
        </article>
        <article className="factor-phase2-metric">
          <p className="factor-phase2-metric__label">可自动发布</p>
          <p className="factor-phase2-metric__value">{publishableCandidates.length}</p>
          <p className="factor-phase2-metric__hint">不会覆盖人工或系统默认因子</p>
        </article>
      </section>

      {notice ? <div className="factor-phase2-empty" role="status">{notice}</div> : null}
      {error ? <div className="factor-phase2-empty factor-phase2-empty--danger" role="alert">{error}</div> : null}

      <section className="factor-quarantine-grid">
        <article className="factor-phase2-panel">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">候选队列</p>
              <h2>候选队列</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--info">{loading ? '同步中' : `${candidates.length} 条`}</span>
          </div>
          <div className="factor-phase2-panel__body">
            {loading ? <div className="factor-phase2-empty">正在读取检疫候选。</div> : null}
            {!loading && candidates.length === 0 ? (
              <div className="factor-phase2-empty">暂无检疫候选。请先从挖掘沙盒接收候选表达式。</div>
            ) : null}
            {candidates.length > 0 ? (
              <ul className="factor-phase2-list">
                {candidates.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      className={`factor-quarantine-candidate ${selected?.id === candidate.id ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => setSelectedId(candidate.id)}
                    >
                      <span>
                        <strong>{candidate.expression}</strong>
                        <small>来源任务 {candidate.source_mining_job_id ?? '待记录'} · {candidate.cluster_id ? `聚类 ${candidate.cluster_id}` : '未聚类'}</small>
                      </span>
                      <i className={`factor-phase2-chip factor-phase2-chip--${chipTone(candidate.status)}`}>
                        {statusLabel(candidate.status)}
                      </i>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </article>

        <article className="factor-phase2-panel">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">检疫报告</p>
              <h2>检疫报告</h2>
            </div>
            {selected ? <span className={`factor-phase2-chip factor-phase2-chip--${chipTone(selected.publish_status)}`}>{publishLabel(selected.publish_status)}</span> : null}
          </div>
          <div className="factor-phase2-panel__body">
            {selected && selectedReport ? (
              <>
                <div className="factor-quarantine-report">
                  <div><span>PIT 门禁</span><strong>{pitLabel(selectedReport.gate.pit ?? selectedReport.pit.status)}</strong></div>
                  <div><span>样本内 Rank IC</span><strong>{num(selectedReport.gate.is_rank_ic ?? selectedReport.metrics.rank_ic)}</strong></div>
                  <div><span>样本外 Rank IC</span><strong>{num(selectedReport.gate.oos_rank_ic)}</strong></div>
                  <div><span>覆盖率</span><strong>{pct(selectedReport.metrics.coverage)}</strong></div>
                  <div><span>最大相关</span><strong>{num(selectedReport.gate.max_abs_correlation)}</strong></div>
                  <div><span>换手</span><strong>{pct(selectedReport.metrics.turnover)}</strong></div>
                </div>
                <p className="factor-phase2-copy">
                  {reportReason(selected)}
                </p>
              </>
            ) : (
              <div className="factor-phase2-empty">暂无候选。</div>
            )}
          </div>
        </article>

        <article className="factor-phase2-panel">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">发布审计</p>
              <h2>发布审计</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--good">来源链路</span>
          </div>
          <div className="factor-phase2-panel__body">
            {latestPublished.length ? latestPublished.map((candidate) => (
              <div className="factor-phase2-row" key={`pub-${candidate.id}`}>
                <div className="factor-phase2-row__top">
                  <strong>{candidate.target_factor_id ?? candidate.id}</strong>
                  <span>{candidate.published_at ? formatDateTime(candidate.published_at) : '待记录'}</span>
                </div>
                <p>来源候选 {candidate.id}，发布前后版本、规则和来源链路已进入审计流。</p>
              </div>
            )) : (
              <div className="factor-phase2-empty">尚无发布事件；通过项发布后会记录来源候选、目标因子和版本。</div>
            )}
          </div>
        </article>

        <article className="factor-phase2-panel">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">拒绝样本</p>
              <h2>拒绝样本库</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--bad">{rejectedCount} 条</span>
          </div>
          <div className="factor-phase2-panel__body">
            {rejectedSamples.length ? rejectedSamples.map((candidate) => (
              <div className="factor-phase2-row" key={`rej-${candidate.id}`}>
                <div className="factor-phase2-row__top">
                  <strong>{candidate.expression}</strong>
                  <span>{candidate.cluster_id ? `聚类 ${candidate.cluster_id}` : '未聚类'}</span>
                </div>
                <p>{rejectedReason(candidate)}</p>
              </div>
            )) : (
              <div className="factor-phase2-empty">暂无拒绝样本。</div>
            )}
          </div>
        </article>
      </section>
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import './factor-phase2-pages.css';

type FactorMiningJobStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'COMPLETED'
  | 'PARTIALLY_FAILED'
  | 'FAILED';

export type FactorMiningJob = {
  id: string;
  name: string;
  status: FactorMiningJobStatus;
  universe: string;
  dateRange: string;
  operators: string[];
  candidateCount: number;
  startDate?: string;
  endDate?: string;
  progressPct: number;
  throughputPerMinute: number;
  failedSampleCount: number;
  topRankIc: number;
  createdAt: string;
  randomSeed?: number | null;
  minRankIc?: number;
  maxDepth?: number;
  topCandidates?: FactorMiningCandidate[];
};

export type FactorMiningCandidate = {
  id: string;
  expression: string;
  family: string;
  rankIc: number;
  coveragePct: number;
  turnoverPct: number;
  riskFlags: string[];
};

export type FactorMiningCreatePayload = {
  universe: string;
  startDate: string;
  endDate: string;
  operators: string[];
  candidateCount: number;
  randomSeed: number;
  minRankIc: number;
  maxDepth: number;
};

export type FactorSandboxApi = {
  listFactorMiningJobs?: () => Promise<FactorMiningJob[]>;
  createFactorMiningJob?: (payload: FactorMiningCreatePayload) => Promise<FactorMiningJob>;
  cancelFactorMiningJob?: (jobId: string) => Promise<FactorMiningJob | void>;
};

export type FactorSandboxPageProps = {
  api?: FactorSandboxApi;
  initialJobs?: FactorMiningJob[];
  initialCandidates?: FactorMiningCandidate[];
  onOpenPitGate?: () => void;
};

const STATUS_LABELS: Record<FactorMiningJobStatus, string> = {
  QUEUED: '排队中',
  RUNNING: '运行中',
  CANCEL_REQUESTED: '取消中',
  CANCELLED: '已取消',
  COMPLETED: '已完成',
  PARTIALLY_FAILED: '部分失败',
  FAILED: '失败',
};

const STATUS_TONES: Record<FactorMiningJobStatus, string> = {
  QUEUED: 'info',
  RUNNING: 'good',
  CANCEL_REQUESTED: 'warn',
  CANCELLED: 'warn',
  COMPLETED: 'good',
  PARTIALLY_FAILED: 'warn',
  FAILED: 'bad',
};

const ACTIVE_JOB_STATUSES = new Set<FactorMiningJobStatus>(['QUEUED', 'RUNNING', 'CANCEL_REQUESTED']);
const MAX_VISIBLE_ROWS = 3;
const OPERATOR_OPTIONS = ['Rank', 'ZScore', 'Winsorize', 'Log', 'Return', 'Std'];
const UNIVERSE_OPTIONS = [
  { value: 'SP500', label: '标普 500 PIT' },
  { value: 'NASDAQ100', label: '纳斯达克 100 PIT' },
];

const RISK_FLAG_LABELS: Record<string, string> = {
  LOW_COVERAGE: '价格 PIT 覆盖不足',
  INSUFFICIENT_CROSS_SECTION: '截面样本不足',
  BELOW_IC_THRESHOLD: '低于 IC 门槛',
};

function formatPct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

function statusChipClass(status: FactorMiningJobStatus): string {
  return `factor-phase2-chip factor-phase2-chip--${STATUS_TONES[status]}`;
}

function riskFlagLabel(flag: string): string {
  return RISK_FLAG_LABELS[flag] ?? (flag.includes('_') ? '运行提示' : flag);
}

function normalizeSignaturePart(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeOperators(value: string[]): string {
  return value.map(normalizeSignaturePart).filter(Boolean).sort().join('|');
}

function numericSignaturePart(value: unknown): string {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? String(numericValue) : '';
}

function splitDateRange(dateRange: string): [string, string] {
  const [start = '', end = ''] = dateRange.split(/\s+(?:至|-)\s+/);
  return [start.trim(), end.trim()];
}

function jobSignature(job: FactorMiningJob): string {
  const [rangeStart, rangeEnd] = splitDateRange(job.dateRange);
  return [
    normalizeSignaturePart(job.universe),
    normalizeSignaturePart(job.startDate ?? rangeStart),
    normalizeSignaturePart(job.endDate ?? rangeEnd),
    normalizeOperators(job.operators),
    numericSignaturePart(job.candidateCount),
    numericSignaturePart(job.minRankIc),
    numericSignaturePart(job.maxDepth),
  ].join('::');
}

function payloadSignature(payload: FactorMiningCreatePayload): string {
  return [
    normalizeSignaturePart(payload.universe),
    normalizeSignaturePart(payload.startDate),
    normalizeSignaturePart(payload.endDate),
    normalizeOperators(payload.operators),
    numericSignaturePart(payload.candidateCount),
    numericSignaturePart(payload.minRankIc),
    numericSignaturePart(payload.maxDepth),
  ].join('::');
}

function uniqueJobs(jobs: FactorMiningJob[]): FactorMiningJob[] {
  const seen = new Set<string>();
  return jobs.filter((job) => {
    const signature = jobSignature(job);
    if (!signature || seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function candidateSignature(candidate: FactorMiningCandidate): string {
  const expression = normalizeSignaturePart(candidate.expression);
  return expression || normalizeSignaturePart(candidate.id);
}

function uniqueCandidates(jobs: FactorMiningJob[], fallback: FactorMiningCandidate[]): FactorMiningCandidate[] {
  const fromJobs = jobs.flatMap((job) => job.topCandidates ?? []);
  const source = fromJobs.length ? fromJobs : fallback;
  const seen = new Set<string>();
  return source
    .filter((candidate) => {
      const signature = candidateSignature(candidate);
      if (!signature || seen.has(signature)) return false;
      seen.add(signature);
      return true;
    })
    .sort((left, right) => Math.abs(right.rankIc) - Math.abs(left.rankIc));
}

function listClassName(itemCount: number): string {
  return itemCount > MAX_VISIBLE_ROWS
    ? 'factor-phase2-list factor-phase2-list--scroll'
    : 'factor-phase2-list';
}

export function FactorSandboxPage({
  api,
  initialJobs = [],
  initialCandidates = [],
  onOpenPitGate,
}: FactorSandboxPageProps): JSX.Element {
  const [jobs, setJobs] = useState<FactorMiningJob[]>(initialJobs);
  const [fallbackCandidates, setFallbackCandidates] = useState<FactorMiningCandidate[]>(initialCandidates);
  const [universe, setUniverse] = useState('SP500');
  const [startDate, setStartDate] = useState('2020-01-01');
  const [endDate, setEndDate] = useState('2025-12-31');
  const [candidateCount, setCandidateCount] = useState(250);
  const [randomSeed, setRandomSeed] = useState(42);
  const [minRankIc, setMinRankIc] = useState(0.035);
  const [maxDepth, setMaxDepth] = useState(4);
  const [operators, setOperators] = useState<string[]>(['Return', 'Rank', 'ZScore']);
  const [loadingJobs, setLoadingJobs] = useState(Boolean(api?.listFactorMiningJobs));
  const [creatingJob, setCreatingJob] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const creatingJobRef = useRef(false);

  useEffect(() => {
    if (!api?.listFactorMiningJobs) {
      return;
    }
    let cancelled = false;
    setLoadingJobs(true);
    api.listFactorMiningJobs()
      .then((runtimeJobs) => {
        if (cancelled) return;
        setJobs(runtimeJobs);
        setFallbackCandidates([]);
        setError(null);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : '读取挖掘任务失败。');
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingJobs(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (!api?.listFactorMiningJobs) {
      return;
    }
    const shouldPoll = creatingJob || jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status));
    if (!shouldPoll) {
      return;
    }
    let cancelled = false;
    const refreshJobs = (): void => {
      api.listFactorMiningJobs?.()
        .then((runtimeJobs) => {
          if (cancelled) return;
          setJobs(runtimeJobs);
          setFallbackCandidates([]);
          setError(null);
        })
        .catch((reason: unknown) => {
          if (cancelled) return;
          setError(reason instanceof Error ? reason.message : '刷新挖掘任务失败。');
        });
    };
    const timer = window.setInterval(refreshJobs, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [api, creatingJob, jobs]);

  const visibleJobs = useMemo(() => uniqueJobs(jobs), [jobs]);

  const candidates = useMemo(
    () => uniqueCandidates(visibleJobs, fallbackCandidates),
    [fallbackCandidates, visibleJobs],
  );

  const summary = useMemo(() => {
    const activeJob = visibleJobs.find((job) => ACTIVE_JOB_STATUSES.has(job.status)) ?? visibleJobs[0];
    const failedSamples = visibleJobs.reduce((total, job) => total + job.failedSampleCount, 0);
    const topRankValues = [
      ...visibleJobs.map((job) => Math.abs(job.topRankIc)).filter((value) => Number.isFinite(value)),
      ...candidates.map((candidate) => Math.abs(candidate.rankIc)).filter((value) => Number.isFinite(value)),
    ];
    const topRankIc = topRankValues.length ? Math.max(...topRankValues) : 0;
    return {
      progress: activeJob?.progressPct ?? 0,
      throughput: activeJob?.throughputPerMinute ?? 0,
      failedSamples,
      topRankIc,
    };
  }, [candidates, visibleJobs]);

  const toggleOperator = (operator: string): void => {
    setOperators((current) => {
      if (current.includes(operator)) {
        return current.filter((item) => item !== operator);
      }
      return [...current, operator];
    });
  };

  const createJob = async (): Promise<void> => {
    if (creatingJobRef.current) {
      return;
    }
    if (!api?.createFactorMiningJob) {
      setError('挖掘任务接口未接入，不能创建本地样例任务。');
      return;
    }
    const payload: FactorMiningCreatePayload = {
      universe,
      startDate,
      endDate,
      operators,
      candidateCount,
      randomSeed,
      minRankIc,
      maxDepth,
    };
    const duplicateJob = visibleJobs.find((job) => jobSignature(job) === payloadSignature(payload));
    if (duplicateJob) {
      setError(null);
      setNotice(`已存在相同任务配置：${duplicateJob.name}。请调整样本池、日期、算子或候选数量后再创建。`);
      return;
    }
    creatingJobRef.current = true;
    setCreatingJob(true);
    setError(null);
    setNotice('正在创建挖掘任务，请勿重复提交。');
    try {
      const createdJob = await api.createFactorMiningJob(payload);
      setJobs((current) => [createdJob, ...current.filter((job) => job.id !== createdJob.id)]);
      setFallbackCandidates([]);
      setNotice(
        ACTIVE_JOB_STATUSES.has(createdJob.status)
          ? `任务已进入运行队列：${createdJob.name}`
          : `已创建挖掘任务：${createdJob.name}`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建挖掘任务失败。');
    } finally {
      creatingJobRef.current = false;
      setCreatingJob(false);
    }
  };

  const cancelJob = async (job: FactorMiningJob): Promise<void> => {
    if (!api?.cancelFactorMiningJob) {
      setError('取消接口未接入，不能改写本地状态。');
      return;
    }
    setError(null);
    try {
      const response = await api.cancelFactorMiningJob(job.id);
      setJobs((current) =>
        current.map((item) => {
          if (item.id !== job.id) return item;
          return response ? { ...item, ...response } : item;
        }),
      );
      setNotice(`已提交取消请求：${job.name}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '取消挖掘任务失败。');
    }
  };

  return (
    <main className="factor-phase2-page factor-sandbox-page" data-page-root="factor-sandbox">
      <section className="factor-phase2-hero" aria-labelledby="factor-sandbox-title">
        <div>
          <p className="factor-phase2-hero__eyebrow">D1 挖掘沙盒 · 点时数据</p>
          <h1 id="factor-sandbox-title">挖掘沙盒</h1>
          <p>
            批量生成受控 DSL 表达式，观察运行进度、吞吐、失败样本与候选摘要。候选只进入沙盒摘要，
            不绕过后续检疫直接写入正式因子库。
          </p>
        </div>
        <div className="factor-phase2-actions" aria-label="挖掘沙盒操作">
          <button className="factor-phase2-button" type="button" onClick={onOpenPitGate}>
            查看 PIT 门禁
          </button>
          <button
            className="factor-phase2-button factor-phase2-button--primary"
            disabled={creatingJob}
            type="button"
            onClick={createJob}
          >
            {creatingJob ? '创建中...' : '创建任务'}
          </button>
        </div>
      </section>

      <section className="factor-phase2-metrics" aria-label="挖掘任务概览">
        <article className="factor-phase2-metric">
          <p className="factor-phase2-metric__label">运行进度</p>
          <p className="factor-phase2-metric__value">{formatPct(summary.progress, 0)}</p>
          <p className="factor-phase2-metric__hint">当前活跃任务完成比例</p>
        </article>
        <article className="factor-phase2-metric">
          <p className="factor-phase2-metric__label">吞吐</p>
          <p className="factor-phase2-metric__value">{summary.throughput}/min</p>
          <p className="factor-phase2-metric__hint">纯 Python 小批量候选评估</p>
        </article>
        <article className="factor-phase2-metric">
          <p className="factor-phase2-metric__label">失败样本</p>
          <p className="factor-phase2-metric__value">{summary.failedSamples}</p>
          <p className="factor-phase2-metric__hint">主要来自 PIT 字段或窗口缺口</p>
        </article>
        <article className="factor-phase2-metric">
          <p className="factor-phase2-metric__label">最高 IC</p>
          <p className="factor-phase2-metric__value">{summary.topRankIc.toFixed(3)}</p>
          <p className="factor-phase2-metric__hint">仅为沙盒排序摘要</p>
        </article>
      </section>

      {error ? <div className="factor-phase2-empty factor-phase2-empty--danger" role="alert">{error}</div> : null}

      <section className="factor-phase2-workbench factor-phase2-workbench--sandbox" aria-label="挖掘沙盒工作台">
        <section className="factor-phase2-panel" aria-labelledby="factor-sandbox-jobs">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">运行队列</p>
              <h2 id="factor-sandbox-jobs">任务队列</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--info">{visibleJobs.length} 个任务</span>
          </div>
          <div className="factor-phase2-panel__body">
            {loadingJobs ? <div className="factor-phase2-empty">正在读取挖掘任务</div> : null}
            {!loadingJobs && visibleJobs.length === 0 ? <div className="factor-phase2-empty">暂无挖掘任务</div> : null}
            {visibleJobs.length > 0 ? (
              <ul aria-label="任务队列列表" className={listClassName(visibleJobs.length)}>
                {visibleJobs.map((job) => (
                  <li className="factor-phase2-row" key={job.id}>
                    <div className="factor-phase2-row__top">
                      <h3>{job.name}</h3>
                      <span className={statusChipClass(job.status)}>{STATUS_LABELS[job.status]}</span>
                    </div>
                    <p>{job.universe} · {job.dateRange}</p>
                    <div className="factor-phase2-progress" aria-label={`${job.name} 进度 ${formatPct(job.progressPct, 0)}`}>
                      <span style={{ width: `${Math.max(0, Math.min(job.progressPct, 100))}%` }} />
                    </div>
                    <div className="factor-phase2-stat-grid">
                      <div className="factor-phase2-stat">
                        <b>{job.candidateCount}</b>
                        <span>候选数量</span>
                      </div>
                      <div className="factor-phase2-stat">
                        <b>{Math.round(job.throughputPerMinute)}/min</b>
                        <span>吞吐</span>
                      </div>
                      <div className="factor-phase2-stat">
                        <b>{job.failedSampleCount}</b>
                        <span>失败样本</span>
                      </div>
                    </div>
                    <div className="factor-phase2-row__meta">
                      <span className="factor-phase2-copy">{job.operators.join(' / ') || '未记录算子'}</span>
                      <button
                        className="factor-phase2-button factor-phase2-button--text"
                        type="button"
                        disabled={!['QUEUED', 'RUNNING'].includes(job.status)}
                        onClick={() => void cancelJob(job)}
                      >
                        取消
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>

        <section className="factor-phase2-panel" aria-labelledby="factor-sandbox-candidates">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">候选排序</p>
              <h2 id="factor-sandbox-candidates">候选摘要</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--warn">待检疫</span>
          </div>
          <div className="factor-phase2-panel__body">
            {candidates.length === 0 ? <div className="factor-phase2-empty">暂无候选摘要</div> : null}
            {candidates.length > 0 ? (
              <ul aria-label="候选摘要列表" className={listClassName(candidates.length)}>
                {candidates.map((candidate) => (
                  <li className="factor-phase2-row" key={candidate.id}>
                    <div className="factor-phase2-row__top">
                      <h3>{candidate.family}</h3>
                      <span className="factor-phase2-chip factor-phase2-chip--good">
                        Rank IC {candidate.rankIc.toFixed(3)}
                      </span>
                    </div>
                    <p>{candidate.expression}</p>
                    <div className="factor-phase2-stat-grid">
                      <div className="factor-phase2-stat">
                        <b>{formatPct(candidate.coveragePct)}</b>
                        <span>PIT 覆盖</span>
                      </div>
                      <div className="factor-phase2-stat">
                        <b>{formatPct(candidate.turnoverPct)}</b>
                        <span>预估换手</span>
                      </div>
                      <div className="factor-phase2-stat">
                        <b>{candidate.riskFlags.length}</b>
                        <span>风险提示</span>
                      </div>
                    </div>
                    <div className="factor-phase2-checks">
                      {candidate.riskFlags.length
                        ? candidate.riskFlags.map((flag) => (
                          <span className="factor-phase2-chip" key={flag}>{riskFlagLabel(flag)}</span>
                        ))
                        : <span className="factor-phase2-chip">暂无阻断提示</span>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </section>

        <section className="factor-phase2-panel" aria-labelledby="factor-sandbox-create">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">任务配置</p>
              <h2 id="factor-sandbox-create">创建任务</h2>
            </div>
          </div>
          <div className="factor-phase2-panel__body">
            <form
              aria-busy={creatingJob}
              className="factor-phase2-form"
              onSubmit={(event) => {
                event.preventDefault();
                void createJob();
              }}
            >
              <div className="factor-phase2-field">
                <label htmlFor="factor-sandbox-universe">样本池</label>
                <select id="factor-sandbox-universe" value={universe} onChange={(event) => setUniverse(event.target.value)}>
                  {UNIVERSE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="factor-phase2-field-group">
                <div className="factor-phase2-field">
                  <label htmlFor="factor-sandbox-start">开始日期</label>
                  <input id="factor-sandbox-start" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
                </div>
                <div className="factor-phase2-field">
                  <label htmlFor="factor-sandbox-end">结束日期</label>
                  <input id="factor-sandbox-end" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
                </div>
              </div>
              <div className="factor-phase2-field">
                <span className="factor-phase2-label">算子集合</span>
                <div className="factor-phase2-checks">
                  {OPERATOR_OPTIONS.map((operator) => (
                    <label className="factor-phase2-check" key={operator}>
                      <input
                        type="checkbox"
                        checked={operators.includes(operator)}
                        onChange={() => toggleOperator(operator)}
                      />
                      {operator}
                    </label>
                  ))}
                </div>
              </div>
              <div className="factor-phase2-field-group">
                <div className="factor-phase2-field">
                  <label htmlFor="factor-sandbox-count">候选数量</label>
                  <input
                    id="factor-sandbox-count"
                    min={50}
                    step={50}
                    type="number"
                    value={candidateCount}
                    onChange={(event) => setCandidateCount(Number(event.target.value))}
                  />
                </div>
                <div className="factor-phase2-field">
                  <label htmlFor="factor-sandbox-seed">随机种子</label>
                  <input
                    id="factor-sandbox-seed"
                    type="number"
                    value={randomSeed}
                    onChange={(event) => setRandomSeed(Number(event.target.value))}
                  />
                </div>
              </div>
              <div className="factor-phase2-field-group">
                <div className="factor-phase2-field">
                  <label htmlFor="factor-sandbox-ic">IC 门槛</label>
                  <input
                    id="factor-sandbox-ic"
                    max={1}
                    min={0}
                    step={0.001}
                    type="number"
                    value={minRankIc}
                    onChange={(event) => setMinRankIc(Number(event.target.value))}
                  />
                </div>
                <div className="factor-phase2-field">
                  <label htmlFor="factor-sandbox-depth">表达式深度</label>
                  <input
                    id="factor-sandbox-depth"
                    max={8}
                    min={1}
                    type="number"
                    value={maxDepth}
                    onChange={(event) => setMaxDepth(Number(event.target.value))}
                  />
                </div>
              </div>
              <button className="factor-phase2-button factor-phase2-button--primary" disabled={creatingJob} type="submit">
                {creatingJob ? '创建中...' : '创建挖掘任务'}
              </button>
              {notice ? <p className="factor-phase2-copy" role="status">{notice}</p> : null}
            </form>
          </div>
        </section>
      </section>

      <section className="factor-phase2-risk-panel" aria-labelledby="factor-sandbox-risk">
        <h2 id="factor-sandbox-risk">风险提示</h2>
        <p>
          候选不会直接进入正式因子库；候选不会直接写入正式因子库，也不会绕过第三期检疫。缺少 `available_at` 的基础面字段只会进入失败样本和阻塞原因，
          不允许使用当前财务数据或静态 mock 补齐。
        </p>
      </section>
    </main>
  );
}

export default FactorSandboxPage;

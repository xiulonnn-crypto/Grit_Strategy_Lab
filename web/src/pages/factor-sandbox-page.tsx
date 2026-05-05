import { useMemo, useState } from 'react';
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
  progressPct: number;
  throughputPerMinute: number;
  failedSampleCount: number;
  topRankIc: number;
  createdAt: string;
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
  createFactorMiningJob?: (payload: FactorMiningCreatePayload) => Promise<FactorMiningJob>;
  cancelFactorMiningJob?: (jobId: string) => Promise<FactorMiningJob | void>;
};

export type FactorSandboxPageProps = {
  api?: FactorSandboxApi;
  initialJobs?: FactorMiningJob[];
  initialCandidates?: FactorMiningCandidate[];
  onOpenPitGate?: () => void;
};

const DEFAULT_JOBS: FactorMiningJob[] = [
  {
    id: 'mine_20260505_001',
    name: 'US Core 1500 · 估值质量混合',
    status: 'RUNNING',
    universe: 'US Core 1500',
    dateRange: '2016-01-01 至 2025-12-31',
    operators: ['Rank', 'ZScore', 'Winsorize', 'Log'],
    candidateCount: 1000,
    progressPct: 64,
    throughputPerMinute: 238,
    failedSampleCount: 17,
    topRankIc: 0.083,
    createdAt: '2026-05-05 09:30',
  },
  {
    id: 'mine_20260504_003',
    name: 'Large Cap · 低波动候选',
    status: 'COMPLETED',
    universe: 'S&P 500 PIT',
    dateRange: '2014-01-01 至 2025-12-31',
    operators: ['Std', 'Return', 'Rank'],
    candidateCount: 1200,
    progressPct: 100,
    throughputPerMinute: 266,
    failedSampleCount: 5,
    topRankIc: 0.071,
    createdAt: '2026-05-04 17:10',
  },
  {
    id: 'mine_20260504_002',
    name: 'Fundamental PIT · 质量扩展',
    status: 'PARTIALLY_FAILED',
    universe: 'Russell 1000 PIT',
    dateRange: '2018-01-01 至 2025-12-31',
    operators: ['ZScore', 'Winsorize', 'Log'],
    candidateCount: 800,
    progressPct: 100,
    throughputPerMinute: 192,
    failedSampleCount: 43,
    topRankIc: 0.058,
    createdAt: '2026-05-04 11:20',
  },
];

const DEFAULT_CANDIDATES: FactorMiningCandidate[] = [
  {
    id: 'cand_001',
    expression: 'ZScore(Winsorize(LtmEarnings / MarketCap))',
    family: '估值',
    rankIc: 0.083,
    coveragePct: 91.2,
    turnoverPct: 34.6,
    riskFlags: ['基础面 available_at 完整', '高相关需检疫'],
  },
  {
    id: 'cand_002',
    expression: 'Rank(Log(BookValueEquity / MarketCap))',
    family: '估值',
    rankIc: 0.079,
    coveragePct: 88.4,
    turnoverPct: 28.9,
    riskFlags: ['BookValue 覆盖缺口 6.1%'],
  },
  {
    id: 'cand_003',
    expression: 'ZScore(Return(Close, 63) - Std(Return(Close, 1), 126))',
    family: '动量',
    rankIc: 0.066,
    coveragePct: 97.5,
    turnoverPct: 42.1,
    riskFlags: ['价格 PIT 可复现'],
  },
];

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

const OPERATOR_OPTIONS = ['Rank', 'ZScore', 'Winsorize', 'Log', 'Return', 'Std'];

function formatPct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

function statusChipClass(status: FactorMiningJobStatus): string {
  return `factor-phase2-chip factor-phase2-chip--${STATUS_TONES[status]}`;
}

export function FactorSandboxPage({
  api,
  initialJobs = DEFAULT_JOBS,
  initialCandidates = DEFAULT_CANDIDATES,
  onOpenPitGate,
}: FactorSandboxPageProps): JSX.Element {
  const [jobs, setJobs] = useState<FactorMiningJob[]>(initialJobs);
  const [candidates] = useState<FactorMiningCandidate[]>(initialCandidates);
  const [universe, setUniverse] = useState('US Core 1500');
  const [startDate, setStartDate] = useState('2016-01-01');
  const [endDate, setEndDate] = useState('2025-12-31');
  const [candidateCount, setCandidateCount] = useState(1000);
  const [randomSeed, setRandomSeed] = useState(42);
  const [minRankIc, setMinRankIc] = useState(0.035);
  const [maxDepth, setMaxDepth] = useState(4);
  const [operators, setOperators] = useState<string[]>(['Rank', 'ZScore', 'Winsorize']);
  const [notice, setNotice] = useState<string | null>(null);

  const summary = useMemo(() => {
    const activeJob = jobs.find((job) => job.status === 'RUNNING') ?? jobs[0];
    const failedSamples = jobs.reduce((total, job) => total + job.failedSampleCount, 0);
    const topRankIc = Math.max(...jobs.map((job) => job.topRankIc), ...candidates.map((candidate) => candidate.rankIc));
    return {
      progress: activeJob?.progressPct ?? 0,
      throughput: activeJob?.throughputPerMinute ?? 0,
      failedSamples,
      topRankIc,
    };
  }, [candidates, jobs]);

  const toggleOperator = (operator: string): void => {
    setOperators((current) => {
      if (current.includes(operator)) {
        return current.filter((item) => item !== operator);
      }
      return [...current, operator];
    });
  };

  const createJob = async (): Promise<void> => {
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
    const fallbackJob: FactorMiningJob = {
      id: `mine_local_${Date.now()}`,
      name: `${universe} · 自动挖掘`,
      status: 'QUEUED',
      universe,
      dateRange: `${startDate} 至 ${endDate}`,
      operators,
      candidateCount,
      progressPct: 0,
      throughputPerMinute: 0,
      failedSampleCount: 0,
      topRankIc: 0,
      createdAt: '刚刚',
    };
    const createdJob = api?.createFactorMiningJob ? await api.createFactorMiningJob(payload) : fallbackJob;
    setJobs((current) => [createdJob, ...current]);
    setNotice(`已创建挖掘任务：${createdJob.name}`);
  };

  const cancelJob = async (job: FactorMiningJob): Promise<void> => {
    const response = api?.cancelFactorMiningJob ? await api.cancelFactorMiningJob(job.id) : undefined;
    setJobs((current) =>
      current.map((item) => {
        if (item.id !== job.id) return item;
        return response ? { ...item, ...response } : { ...item, status: 'CANCELLED', progressPct: item.progressPct };
      }),
    );
    setNotice(`已提交取消请求：${job.name}`);
  };

  return (
    <main className="factor-phase2-page factor-sandbox-page" data-page-root="factor-sandbox">
      <section className="factor-phase2-hero" aria-labelledby="factor-sandbox-title">
        <div>
          <p className="factor-phase2-hero__eyebrow">D1 挖掘沙盒 · 点时数据</p>
          <h1 id="factor-sandbox-title">挖掘沙盒</h1>
          <p>
            批量生成受控 DSL 表达式，观察运行进度、吞吐、失败样本与 Top candidates。候选只进入沙盒摘要，
            不绕过后续检疫直接写入正式因子库。
          </p>
        </div>
        <div className="factor-phase2-actions" aria-label="挖掘沙盒操作">
          <button className="factor-phase2-button" type="button" onClick={onOpenPitGate}>
            查看 PIT 门禁
          </button>
          <button className="factor-phase2-button factor-phase2-button--primary" type="button" onClick={createJob}>
            创建任务
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
          <p className="factor-phase2-metric__label">Top IC</p>
          <p className="factor-phase2-metric__value">{summary.topRankIc.toFixed(3)}</p>
          <p className="factor-phase2-metric__hint">仅为沙盒排序摘要</p>
        </article>
      </section>

      <section className="factor-phase2-workbench factor-phase2-workbench--sandbox" aria-label="挖掘沙盒工作台">
        <section className="factor-phase2-panel" aria-labelledby="factor-sandbox-jobs">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">Job Queue</p>
              <h2 id="factor-sandbox-jobs">任务队列</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--info">{jobs.length} 个任务</span>
          </div>
          <div className="factor-phase2-panel__body">
            <ul className="factor-phase2-list">
              {jobs.map((job) => (
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
                      <b>{job.throughputPerMinute}/min</b>
                      <span>吞吐</span>
                    </div>
                    <div className="factor-phase2-stat">
                      <b>{job.failedSampleCount}</b>
                      <span>失败样本</span>
                    </div>
                  </div>
                  <div className="factor-phase2-row__meta">
                    <span className="factor-phase2-copy">{job.operators.join(' / ')}</span>
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
          </div>
        </section>

        <section className="factor-phase2-panel" aria-labelledby="factor-sandbox-candidates">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">Top Candidates</p>
              <h2 id="factor-sandbox-candidates">Top candidates</h2>
            </div>
            <span className="factor-phase2-chip factor-phase2-chip--warn">待检疫</span>
          </div>
          <div className="factor-phase2-panel__body">
            <ul className="factor-phase2-list">
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
                    {candidate.riskFlags.map((flag) => (
                      <span className="factor-phase2-chip" key={flag}>{flag}</span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="factor-phase2-panel" aria-labelledby="factor-sandbox-create">
          <div className="factor-phase2-panel__header">
            <div>
              <p className="factor-phase2-panel__eyebrow">Create Job</p>
              <h2 id="factor-sandbox-create">创建任务</h2>
            </div>
          </div>
          <div className="factor-phase2-panel__body">
            <form
              className="factor-phase2-form"
              onSubmit={(event) => {
                event.preventDefault();
                void createJob();
              }}
            >
              <div className="factor-phase2-field">
                <label htmlFor="factor-sandbox-universe">Universe</label>
                <select id="factor-sandbox-universe" value={universe} onChange={(event) => setUniverse(event.target.value)}>
                  <option value="US Core 1500">US Core 1500</option>
                  <option value="S&P 500 PIT">S&P 500 PIT</option>
                  <option value="Russell 1000 PIT">Russell 1000 PIT</option>
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
              <button className="factor-phase2-button factor-phase2-button--primary" type="submit">
                创建挖掘任务
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

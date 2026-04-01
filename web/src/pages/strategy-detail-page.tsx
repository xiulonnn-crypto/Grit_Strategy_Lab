import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import { formatDateTime, formatPercent, formatRatio, formatShortDate } from '../lib/format';
import type { ApiBacktestRunDetail, ApiStrategyDetail } from '../types';
import './strategy-detail-page.css';

const TEXT = {
  eyebrow: '策略详情',
  title: '策略概况',
  description: '查看当前参数版本、历史策略记录和可直接执行的下一步。',
  backWorkspace: '返回工作台',
  runBacktest: '运行回测',
  openOptimization: '打开优化',
  currentVersion: '当前参数版本',
  strategySummary: '策略概况',
  parameterHistory: '参数版本历史',
  recentRun: '最近回测',
  currentRun: '主要信息',
  noHistory: '当前没有版本历史。',
  loading: '正在加载策略详情...',
  runHint: '使用真实回测数据和最近可执行的操作。',
} as const;

function MetricCard({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <article className="metric-card strategy-detail-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function strategyTypeLabel(value: string): string {
  const map: Record<string, string> = {
    MOMENTUM: '动量 / 趋势跟随',
    GRID: '网格交易',
    MEAN_REVERSION: '均值回归',
    BUY_AND_HOLD: '指数 / 定投',
    GENERAL: '通用策略',
  };
  return map[value] ?? value;
}

function strategyStatusLabel(value: string): string {
  const lowered = value.toLowerCase();
  if (lowered.includes('complete') || lowered.includes('done') || lowered.includes('success')) return '已完成';
  if (lowered.includes('pending') || lowered.includes('queued') || lowered.includes('running')) return '进行中';
  if (lowered.includes('fail') || lowered.includes('error')) return '失败';
  return value;
}

function actionLabel(value: string): string {
  const map: Record<string, string> = {
    backtest: '运行回测',
    optimize: '打开优化',
    materialize: '生成策略',
    compare: '加入对比',
  };
  return map[value] ?? value;
}

function formatStrategyMetric(value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  return formatPercent(value);
}

function formatRunMetric(key: string, value: unknown): string {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return '-';
  }
  if (key.includes('sharpe') || key.includes('ratio')) {
    return formatRatio(value);
  }
  if (key.includes('return') || key.includes('drawdown') || key.includes('rate')) {
    return formatPercent(value);
  }
  return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);
}

export function StrategyDetailPage({ strategyId }: { strategyId: string }): JSX.Element {
  const api = useApiClient();
  const [strategy, setStrategy] = useState<ApiStrategyDetail | null>(null);
  const [latestRun, setLatestRun] = useState<ApiBacktestRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const latestRunId = strategy?.latest_successful_run_id ?? strategy?.latest_run_id ?? null;
  const canOpenOptimization = Boolean(strategy?.latest_optimization_job_id);
  const parameterHistoryRows = useMemo(() => strategy?.parameter_history ?? [], [strategy]);

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

  useEffect(() => {
    let cancelled = false;

    async function loadLatestRun(): Promise<void> {
      if (!latestRunId) {
        setLatestRun(null);
        return;
      }

      try {
        const payload = await api.getBacktestRunDetail(latestRunId);
        if (!cancelled) {
          setLatestRun(payload);
        }
      } catch {
        if (!cancelled) {
          setLatestRun(null);
        }
      }
    }

    void loadLatestRun();
    return () => {
      cancelled = true;
    };
  }, [api, latestRunId]);

  if (loading) {
    return (
      <section className="panel strategy-detail-page">
        <div className="panel-header">
          <h2>{TEXT.title}</h2>
        </div>
        <p className="hero-copy">{TEXT.loading}</p>
      </section>
    );
  }

  if (error || !strategy) {
    return (
      <section className="panel strategy-detail-page">
        <div className="panel-header">
          <h2>{TEXT.title}</h2>
        </div>
        <p className="hero-copy">{error ?? '策略详情无法加载。'}</p>
      </section>
    );
  }

  return (
    <div className="stack strategy-detail-page">
      <section className="strategy-detail-hero panel">
        <div className="strategy-detail-hero__copy">
          <p className="eyebrow">{TEXT.eyebrow}</p>
          <h2>{strategy.name}</h2>
          <p className="hero-copy">{TEXT.description}</p>
        </div>
        <div className="strategy-detail-hero__actions">
          <button className="ghost-button" onClick={() => navigateTo('/workspace')} type="button">
            {TEXT.backWorkspace}
          </button>
          <button className="primary-button" onClick={() => navigateTo(`/strategies/${strategy.id}/backtest-runs/new`)} type="button">
            {TEXT.runBacktest}
          </button>
          <button
            className="ghost-button"
            disabled={!canOpenOptimization}
            onClick={() => strategy.latest_optimization_job_id && navigateTo(`/optimization-jobs/${strategy.latest_optimization_job_id}`)}
            type="button"
          >
            {TEXT.openOptimization}
          </button>
        </div>
      </section>

      <div className="strategy-detail-grid">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">{TEXT.strategySummary}</p>
              <h3>{strategy.name}</h3>
            </div>
            <span className="status-chip">{strategyTypeLabel(strategy.strategy_type)}</span>
          </div>
          <div className="summary-grid">
            <MetricCard label="策略类型" value={strategyTypeLabel(strategy.strategy_type)} />
            <MetricCard label="对象池" value={strategy.universe_name} />
            <MetricCard label="再平衡" value={String(strategy.rebalance_frequency ?? '-')} />
            <MetricCard label="当前版本" value={String(strategy.current_parameter_version ?? '-')} />
            <MetricCard label="数据集快照" value={String(strategy.dataset_snapshot_id ?? '-')} />
            <MetricCard label="股票池快照" value={String(strategy.universe_snapshot_id ?? '-')} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">{TEXT.currentVersion}</p>
              <h3>{String(strategy.current_parameter_version_id ?? '未指定')}</h3>
            </div>
          </div>
          <div className="summary-grid">
            <MetricCard label="参数版本" value={String(strategy.current_parameter_version ?? '-')} />
            <MetricCard label="创建时间" value={strategy.created_at ? formatDateTime(strategy.created_at) : '-'} />
            <MetricCard label="更新时间" value={strategy.updated_at ? formatDateTime(strategy.updated_at) : '-'} />
            <MetricCard label="可用动作" value={strategy.allowed_actions?.length ? '已加载' : '未提供'} />
          </div>
          {parameterHistoryRows.length ? (
            <div className="history-list">
              {parameterHistoryRows.map((entry) => (
                <article className="history-card" key={entry.parameter_version_id}>
                  <div className="history-card__header">
                    <strong>v{entry.version_number}</strong>
                    <span className="status-chip status-chip--soft">{entry.parameter_version_id}</span>
                  </div>
                  <p>{entry.comment ?? '无备注'}</p>
                  <div className="history-card__meta">
                    <span>{entry.created_at ? formatShortDate(entry.created_at) : '待定'}</span>
                    <span>{entry.revision}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="empty-state">{TEXT.noHistory}</p>
          )}
        </section>
      </div>

      <div className="strategy-detail-grid strategy-detail-grid--lower">
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">{TEXT.recentRun}</p>
              <h3>{latestRun?.id ?? '暂无最近回测'}</h3>
            </div>
            {latestRun ? <span className="status-chip">{strategyStatusLabel(latestRun.status)}</span> : null}
          </div>
          {latestRun ? (
            <>
              <p className="hero-copy">{TEXT.runHint}</p>
              <div className="summary-grid">
                <MetricCard label="总收益" value={formatRunMetric('total_return', latestRun.metrics.total_return)} />
                <MetricCard label="夏普比率" value={formatRunMetric('sharpe', latestRun.metrics.sharpe ?? 0)} />
                <MetricCard label="最大回撤" value={formatRunMetric('max_drawdown', latestRun.metrics.max_drawdown)} />
                <MetricCard label="证据数" value={String(latestRun.trades_count ?? latestRun.trade_details?.length ?? 0)} />
              </div>
              <div className="hero-actions">
                <button className="ghost-button" onClick={() => latestRun.id && navigateTo(`/runs/${latestRun.id}`)} type="button">
                  进入运行详情
                </button>
              </div>
            </>
          ) : (
            <p className="empty-state">暂无最近回测记录。</p>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">策略操作</p>
              <h3>可执行的下一步</h3>
            </div>
          </div>
          <div className="chip-row">
            {(strategy.allowed_actions ?? []).map((action) => (
              <span className="status-chip status-chip--soft" key={action}>
                {actionLabel(action)}
              </span>
            ))}
            {!strategy.allowed_actions?.length ? <span className="status-chip status-chip--soft">等待更多操作</span> : null}
          </div>
          <div className="hero-actions">
            <button className="primary-button" onClick={() => navigateTo(`/strategies/${strategy.id}/backtest-runs/new`)} type="button">
              {TEXT.runBacktest}
            </button>
            <button
              className="ghost-button"
              disabled={!canOpenOptimization}
              onClick={() => strategy.latest_optimization_job_id && navigateTo(`/optimization-jobs/${strategy.latest_optimization_job_id}`)}
              type="button"
            >
              {TEXT.openOptimization}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

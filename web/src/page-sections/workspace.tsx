import { useMemo, useState } from 'react';
import type { WorkspaceStrategyCardVM } from '../lib/workspace-adapters';

type WorkspaceStrategySectionProps = {
  strategies: WorkspaceStrategyCardVM[];
  loading?: boolean;
  error?: string | null;
  navigate: (path: string) => void;
};

const TEXT = {
  eyebrow: '对比看板',
  title: '稳态当前版本策略',
  copy: '选择 2 到 4 个策略可打开对比平台，锁定卡会显示不可对比的理由。',
  openCompare: '打开对比舱',
  closeCompare: '关闭',
  clear: '清空',
  compareTitle: '策略对比舱',
  compareHint: '这里只展示当前参数版本最新完成的正式回测。',
  loadingTitle: '对比看板',
  loadingCopy: '加载策略卡片中...',
  emptyTitle: '暂无可对比策略',
  emptyCopy: '先 materialize 一个策略，再回到这里发起对比。',
} as const;

function Sparkline({ points }: { points?: WorkspaceStrategyCardVM['sparklinePoints'] }): JSX.Element {
  if (!points?.length) {
    return <div className="workspace-sparkline workspace-sparkline--empty">暂无趋势</div>;
  }

  const values = points.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 240;
  const height = 72;
  const denom = max - min || 1;
  const path = points
    .map((point, index) => {
      const x = (index / Math.max(1, points.length - 1)) * width;
      const y = height - ((point.equity - min) / denom) * (height - 8) - 4;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg className="workspace-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="策略走势">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="2.25" />
    </svg>
  );
}

function StatChip({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="workspace-stat-chip">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function CompareStat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="workspace-compare-table__cell">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export function WorkspaceStrategySection({ strategies, loading, error, navigate }: WorkspaceStrategySectionProps): JSX.Element {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const normalizedStrategies = useMemo(() => strategies, [strategies]);
  const selectedStrategies = useMemo(
    () => normalizedStrategies.filter((strategy) => selectedIds.includes(strategy.id)),
    [normalizedStrategies, selectedIds],
  );

  function toggleSelection(strategyId: string): void {
    setSelectedIds((current) => {
      if (current.includes(strategyId)) {
        return current.filter((id) => id !== strategyId);
      }
      if (current.length >= 4) {
        return current;
      }
      return [...current, strategyId];
    });
  }

  if (loading) {
    return (
      <section className="panel workspace-board-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{TEXT.eyebrow}</p>
            <h3>{TEXT.loadingTitle}</h3>
          </div>
        </div>
        <p className="empty-state">{TEXT.loadingCopy}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel workspace-board-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{TEXT.eyebrow}</p>
            <h3>{TEXT.loadingTitle}</h3>
          </div>
        </div>
        <div className="error-banner" role="alert">{error}</div>
      </section>
    );
  }

  if (!normalizedStrategies.length) {
    return (
      <section className="panel workspace-board-panel workspace-board-panel--empty">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{TEXT.eyebrow}</p>
            <h3>{TEXT.emptyTitle}</h3>
          </div>
        </div>
        <p className="empty-state">{TEXT.emptyCopy}</p>
      </section>
    );
  }

  return (
    <section className="panel workspace-board-panel">
      <div className="panel-header workspace-board-panel__header">
        <div>
          <p className="eyebrow">{TEXT.eyebrow}</p>
          <h3>{TEXT.title}</h3>
          <p className="hero-copy">{TEXT.copy}</p>
        </div>
        <button className="ghost-button" disabled={selectedIds.length < 2} onClick={() => setCompareOpen(true)} type="button">
          {TEXT.openCompare}
        </button>
      </div>

      <div className="workspace-card-grid">
        {normalizedStrategies.map((strategy) => {
          const checked = selectedIds.includes(strategy.id);
          const blocked = !strategy.compareEligible || (!checked && selectedIds.length >= 4);
          return (
            <article className="workspace-strategy-card" key={strategy.id}>
              <div className="workspace-card-header">
                <div>
                  <p className="eyebrow">{strategy.strategyType}</p>
                  <h4>{strategy.name}</h4>
                </div>
                <label className="compare-toggle">
                  <input
                    aria-label={`选择 ${strategy.name} 进行对比`}
                    checked={checked}
                    disabled={blocked}
                    onChange={() => toggleSelection(strategy.id)}
                    type="checkbox"
                  />
                  对比
                </label>
              </div>

              <p className="workspace-card-copy">
                {strategy.universeName} · v{strategy.parameterVersion}
              </p>

              {strategy.compareBlocker ? <p className="workspace-card-warning">{strategy.compareBlocker}</p> : null}

              <Sparkline points={strategy.sparklinePoints} />

              <div className="workspace-card-stats">
                <StatChip label="累计收益" value={strategy.summary?.totalReturn ?? '待回测'} />
                <StatChip label="年化收益" value={strategy.summary?.annualizedReturn ?? '待回测'} />
                <StatChip label="夏普比率" value={strategy.summary?.sharpe ?? '待回测'} />
                <StatChip label="最大回撤" value={strategy.summary?.maxDrawdown ?? '待回测'} />
              </div>

              <div className="card-actions">
                <button className="text-button" onClick={() => navigate(`/strategies/${strategy.id}`)} type="button">
                  打开策略
                </button>
                <button className="text-button" onClick={() => navigate(`/strategies/${strategy.id}/backtest-runs/new`)} type="button">
                  创建回测
                </button>
                {strategy.latestOptimizationJobId ? (
                  <button className="text-button" onClick={() => navigate(`/optimization-jobs/${strategy.latestOptimizationJobId}`)} type="button">
                    打开优化
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <section className="workspace-compare-summary">
        <div className="workspace-compare-summary__header">
          <div>
            <p className="eyebrow">{TEXT.eyebrow}</p>
            <h3>{TEXT.compareTitle}</h3>
            <p className="hero-copy">已选择 {selectedIds.length} 个，选择 2-4 个就能打开对比舱。</p>
          </div>
          <div className="hero-actions">
            <button className="ghost-button" disabled={selectedIds.length < 2} onClick={() => setCompareOpen(true)} type="button">
              {TEXT.openCompare}
            </button>
            <button className="text-button" onClick={() => setSelectedIds([])} type="button">
              {TEXT.clear}
            </button>
          </div>
        </div>
        {selectedStrategies.length ? (
          <div className="workspace-selected-pills">
            {selectedStrategies.map((strategy) => (
              <span className="workspace-selected-pill" key={strategy.id}>
                {strategy.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="empty-state">尚未选择策略。</p>
        )}
      </section>

      {compareOpen ? (
        <div className="workspace-compare-panel" role="dialog" aria-label="策略对比舱">
          <div className="panel-header">
            <div>
              <p className="eyebrow">{TEXT.eyebrow}</p>
              <h3>{TEXT.compareTitle}</h3>
              <p className="hero-copy">{TEXT.compareHint}</p>
            </div>
            <button className="text-button" onClick={() => setCompareOpen(false)} type="button">
              {TEXT.closeCompare}
            </button>
          </div>
          <div className="workspace-compare-grid">
            {selectedStrategies.map((strategy) => (
              <section className="workspace-compare-column" key={strategy.id}>
                <header>
                  <h4>{strategy.name}</h4>
                  <p>v{strategy.parameterVersion}</p>
                </header>
                <div className="workspace-compare-table">
                  <CompareStat label="状态" value={strategy.cardState} />
                  <CompareStat label="收益" value={strategy.summary?.totalReturn ?? '待回测'} />
                  <CompareStat label="夏普" value={strategy.summary?.sharpe ?? '待回测'} />
                  <CompareStat label="回撤" value={strategy.summary?.maxDrawdown ?? '待回测'} />
                  <CompareStat label="股票池" value={strategy.universeName} />
                  <CompareStat label="参数版本" value={`v${strategy.parameterVersion}`} />
                </div>
              </section>
            ))}
          </div>
          <p className="workspace-compare-panel__foot">{selectedStrategies.length < 2 ? '至少需要选择 2 个策略。' : '对比舱已准备好。'}</p>
        </div>
      ) : null}
    </section>
  );
}


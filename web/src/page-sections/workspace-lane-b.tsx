import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceStrategyCardVM } from '../lib/workspace-adapters';

type WorkspaceStrategySectionProps = {
  strategies: WorkspaceStrategyCardVM[];
  loading?: boolean;
  error?: string | null;
  navigate: (path: string) => void;
  latestStrategyId?: string | null;
};

const TEXT = {
  title: '策略看板',
  copy: '卡片严格绑定当前参数版本，并配备轻量 SVG 趋势图与策略对比能力。',
  openLatest: '打开最新策略',
  compareReady: '已选择 {count} 个策略，可进入对比。',
  openCompare: '打开对比',
  closeCompare: '关闭',
  clear: '清空',
  compareTitle: '策略对比',
  compareHint: '对比视图沿用当前参数版本的关键指标，便于快速查看差异。',
  loadingTitle: '策略看板',
  loadingCopy: '正在加载策略看板…',
  emptyTitle: '暂无策略',
  emptyCopy: '先创建或 materialize 一个策略，工作台会在这里显示当前参数版本。',
} as const;

type PlotPoint = {
  x: number;
  y: number;
};

function getStrategyStateMeta(cardState: WorkspaceStrategyCardVM['cardState']): { label: string; tone: 'ready' | 'pending' | 'running' } {
  switch (cardState) {
    case 'READY':
      return { label: '就绪', tone: 'ready' };
    case 'RUNNING_CURRENT_VERSION':
      return { label: '运行中', tone: 'running' };
    default:
      return { label: '待回测', tone: 'pending' };
  }
}

function getStrategyTypeLabel(strategyType: string): string {
  switch (strategyType) {
    case 'MOMENTUM':
      return '动量';
    case 'GRID':
      return '网格';
    case 'MEAN_REVERSION':
      return '均值回归';
    case 'BUY_AND_HOLD':
      return '买入持有';
    default:
      return '通用';
  }
}

function createPlaceholderSparkline(seed: string): Array<{ date: string; equity: number; isOos: boolean }> {
  let value = 100;
  return Array.from({ length: 10 }, (_, index) => {
    const charCode = seed.charCodeAt(index % seed.length) || 65;
    value += ((charCode + index * 13) % 9) - 2;
    return {
      date: `placeholder-${index}`,
      equity: value,
      isOos: index >= 6,
    };
  });
}

function toPlotPoints(
  points: Array<{ date: string; equity: number; isOos: boolean }>,
  width: number,
  height: number,
): PlotPoint[] {
  const values = points.map((point) => point.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const denom = max - min || 1;
  return points.map((point, index) => {
    const x = 10 + (index / Math.max(1, points.length - 1)) * (width - 20);
    const y = height - 12 - ((point.equity - min) / denom) * (height - 26);
    return { x, y };
  });
}

function buildSmoothPath(points: PlotPoint[]): string {
  if (points.length === 0) {
    return '';
  }
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y}`;
  }

  const commands = [`M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    commands.push(
      `C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
    );
  }

  return commands.join(' ');
}

function buildAreaPath(points: PlotPoint[], height: number): string {
  if (points.length === 0) {
    return '';
  }

  const linePath = buildSmoothPath(points);
  const baseline = height - 6;
  const first = points[0];
  const last = points[points.length - 1];
  return `${linePath} L ${last.x.toFixed(2)} ${baseline} L ${first.x.toFixed(2)} ${baseline} Z`;
}

function Sparkline({
  strategyId,
  points,
}: {
  strategyId: string;
  points?: WorkspaceStrategyCardVM['sparklinePoints'];
}): JSX.Element {
  const normalizedPoints = points?.length ? points : createPlaceholderSparkline(strategyId);
  const width = 320;
  const height = 84;
  const plotPoints = toPlotPoints(normalizedPoints, width, height);
  const linePath = buildSmoothPath(plotPoints);
  const areaPath = buildAreaPath(plotPoints, height);

  return (
    <svg className="workspace-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="策略走势">
      <defs>
        <linearGradient id={`spark-fill-${strategyId}`} x1="0%" x2="0%" y1="0%" y2="100%">
          <stop offset="0%" stopColor="#E6F4F1" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#E6F4F1" stopOpacity="0.22" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#spark-fill-${strategyId})`} />
      <path d={linePath} fill="none" stroke="#1F877B" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.4" />
    </svg>
  );
}

function StatChip({ label, value }: { label: string; value: string }): JSX.Element {
  const tone = value.startsWith('+') ? 'positive' : value.startsWith('-') ? 'negative' : 'neutral';
  return (
    <div className="workspace-stat-chip">
      <span>{label}</span>
      <strong className={`workspace-stat-chip__value workspace-stat-chip__value--${tone}`}>{value}</strong>
    </div>
  );
}

function parseExecutionPolicy(metaPrimary?: string): string {
  if (!metaPrimary?.startsWith('执行策略 ')) {
    return '-';
  }
  return metaPrimary.replace('执行策略 ', '') || '-';
}

function parseSnapshotIds(metaSecondary?: string): { datasetSnapshotId: string; universeSnapshotId: string } {
  if (!metaSecondary) {
    return { datasetSnapshotId: '-', universeSnapshotId: '-' };
  }

  if (metaSecondary.startsWith('快照 ')) {
    const raw = metaSecondary.replace('快照 ', '');
    const [datasetSnapshotId, universeSnapshotId] = raw.split(' / ');
    return {
      datasetSnapshotId: datasetSnapshotId || '-',
      universeSnapshotId: universeSnapshotId || '-',
    };
  }

  if (metaSecondary.startsWith('数据快照 ')) {
    return {
      datasetSnapshotId: metaSecondary.replace('数据快照 ', '') || '-',
      universeSnapshotId: '-',
    };
  }

  if (metaSecondary.startsWith('股票池快照 ')) {
    return {
      datasetSnapshotId: '-',
      universeSnapshotId: metaSecondary.replace('股票池快照 ', '') || '-',
    };
  }

  return { datasetSnapshotId: '-', universeSnapshotId: '-' };
}

function formatRecentEditLabel(value?: string | null): string {
  return `最近编辑时间 ${value ?? '时间未知'}`;
}

export function WorkspaceStrategySection({
  strategies,
  loading,
  error,
  navigate,
  latestStrategyId,
}: WorkspaceStrategySectionProps): JSX.Element {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const comparePanelRef = useRef<HTMLElement | null>(null);
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

  function removeSelection(strategyId: string): void {
    setSelectedIds((current) => current.filter((id) => id !== strategyId));
  }

  function openCompareCabin(): void {
    if (selectedStrategies.length < 2) {
      return;
    }
    setCompareOpen(true);
  }

  useEffect(() => {
    if (compareOpen && selectedStrategies.length >= 2 && comparePanelRef.current) {
      const { scrollIntoView } = comparePanelRef.current;
      if (typeof scrollIntoView === 'function') {
        scrollIntoView.call(comparePanelRef.current, { behavior: 'smooth', block: 'start' });
      }
    }
  }, [compareOpen, selectedStrategies.length]);

  useEffect(() => {
    if (selectedStrategies.length < 2 && compareOpen) {
      setCompareOpen(false);
    }
  }, [compareOpen, selectedStrategies.length]);

  if (loading) {
    return (
      <section className="panel workspace-board-panel gsl-card">
        <div className="workspace-board-panel__header">
          <div>
            <h3>{TEXT.loadingTitle}</h3>
          </div>
        </div>
        <p className="empty-state">{TEXT.loadingCopy}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel workspace-board-panel gsl-card">
        <div className="workspace-board-panel__header">
          <div>
            <h3>{TEXT.loadingTitle}</h3>
          </div>
        </div>
        <div className="error-banner" role="alert">
          {error}
        </div>
      </section>
    );
  }

  if (!normalizedStrategies.length) {
    return (
      <section className="panel workspace-board-panel workspace-board-panel--empty gsl-card">
        <div className="workspace-board-panel__header">
          <div>
            <h3>{TEXT.emptyTitle}</h3>
          </div>
        </div>
        <p className="empty-state">{TEXT.emptyCopy}</p>
      </section>
    );
  }

  return (
    <section className="panel workspace-board-panel gsl-card">
      <div className="workspace-board-panel__header">
        <div>
          <h3>{TEXT.title}</h3>
          <p className="hero-copy">{TEXT.copy}</p>
        </div>
        {latestStrategyId ? (
          <button className="ghost-button workspace-board-panel__latest" onClick={() => navigate(`/strategies/${latestStrategyId}`)} type="button">
            {TEXT.openLatest}
          </button>
        ) : null}
      </div>

      <div className="workspace-card-grid">
        {normalizedStrategies.map((strategy) => {
          const checked = selectedIds.includes(strategy.id);
          const blocked = !strategy.compareEligible || (!checked && selectedIds.length >= 4);
          const stateMeta = getStrategyStateMeta(strategy.cardState);

          return (
            <article className="workspace-strategy-card gsl-card" key={strategy.id}>
              <div className="workspace-card-header">
                <div className="workspace-card-title">
                  <div className="workspace-card-badges">
                    <span className="workspace-card-version">v{strategy.parameterVersion}</span>
                    <span className={`workspace-card-state workspace-card-state--${stateMeta.tone}`}>{stateMeta.label}</span>
                  </div>
                  <h4 title={strategy.name}>{strategy.name}</h4>
                  <p className="workspace-card-copy">
                    {strategy.auxiliaryCopy ?? '当前参数版本已可加入对比。'}
                  </p>
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

              <div className="workspace-sparkline-shell">
                <Sparkline points={strategy.sparklinePoints} strategyId={strategy.id} />
              </div>

              <div className="workspace-card-stats strategy-grid-2x2">
                <StatChip label="累计收益" value={strategy.summary?.totalReturn ?? '待回测'} />
                <StatChip label="年化收益率" value={strategy.summary?.annualizedReturn ?? '待回测'} />
                <StatChip label="夏普比率" value={strategy.summary?.sharpe ?? '待回测'} />
                <StatChip label="样本外收益" value={strategy.summary?.oosTotalReturn ?? '待回测'} />
              </div>

              <div className="workspace-card-footer">
                <div className="workspace-card-meta">
                  <p className="workspace-card-meta-row workspace-card-meta-row--time">
                    {formatRecentEditLabel(strategy.metaTimestamp)}
                  </p>
                </div>

                <button className="ghost-button workspace-card-action workspace-action-button" onClick={() => navigate(`/strategies/${strategy.id}`)} type="button">
                  打开策略
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {selectedStrategies.length > 0 ? (
        <div className="workspace-compare-dock" role="region" aria-label="对比选择">
          <div className="workspace-compare-dock__header">
            <div className="workspace-compare-dock__copy">
              <h4>对比选择</h4>
              <p>已选择 {selectedStrategies.length} 个，选择 2-4 个就绪策略后可打开对比舱。</p>
            </div>
            <div className="workspace-compare-dock__actions">
              <button
                className="ghost-button workspace-action-button"
                disabled={selectedStrategies.length < 2}
                onClick={openCompareCabin}
                type="button"
              >
                打开对比舱
              </button>
              <button className="text-button gsl-text-link" onClick={() => setSelectedIds([])} type="button">
                清空
              </button>
            </div>
          </div>
          <div className="workspace-compare-dock__chips">
            {selectedStrategies.map((strategy) => (
              <button
                className="workspace-compare-chip"
                key={strategy.id}
                onClick={() => removeSelection(strategy.id)}
                type="button"
              >
                <span>{strategy.name}</span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {compareOpen ? (
        <section className="workspace-compare-panel" ref={comparePanelRef} aria-label="策略对比舱">
          <div className="workspace-compare-panel__header">
            <div>
              <h3>策略对比舱</h3>
              <p className="hero-copy">这里仅展示当前参数版本最新完成的正式回测。</p>
            </div>
            <button className="ghost-button workspace-action-button" onClick={() => setCompareOpen(false)} type="button">
              关闭
            </button>
          </div>

          <div className="workspace-compare-table-shell">
            <table className="workspace-compare-matrix">
              <thead>
                <tr>
                  <th scope="col">指标</th>
                  {selectedStrategies.map((strategy) => (
                    <th key={strategy.id} scope="col">
                      <div className="workspace-compare-matrix__column">
                        <strong>{strategy.name}</strong>
                        <span className="workspace-compare-matrix__version">V{strategy.parameterVersion}</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[
                  {
                    label: '卡片状态',
                    render: (strategy: WorkspaceStrategyCardVM) => getStrategyStateMeta(strategy.cardState).label,
                  },
                  {
                    label: '累计收益',
                    render: (strategy: WorkspaceStrategyCardVM) => strategy.summary?.totalReturn ?? '待回测',
                  },
                  {
                    label: '年化收益率',
                    render: (strategy: WorkspaceStrategyCardVM) => strategy.summary?.annualizedReturn ?? '待回测',
                  },
                  {
                    label: '夏普比率',
                    render: (strategy: WorkspaceStrategyCardVM) => strategy.summary?.sharpe ?? '待回测',
                  },
                  {
                    label: '最大回撤',
                    render: (strategy: WorkspaceStrategyCardVM) => strategy.summary?.maxDrawdown ?? '-',
                  },
                  {
                    label: '样本外收益',
                    render: (strategy: WorkspaceStrategyCardVM) => strategy.summary?.oosTotalReturn ?? '待回测',
                  },
                  {
                    label: '样本外夏普',
                    render: (strategy: WorkspaceStrategyCardVM) => strategy.summary?.oosSharpe ?? '-',
                  },
                  {
                    label: '执行策略',
                    render: (strategy: WorkspaceStrategyCardVM) => parseExecutionPolicy(strategy.metaPrimary),
                  },
                  {
                    label: '数据集快照',
                    render: (strategy: WorkspaceStrategyCardVM) => parseSnapshotIds(strategy.metaSecondary).datasetSnapshotId,
                  },
                  {
                    label: '股票池快照',
                    render: (strategy: WorkspaceStrategyCardVM) => parseSnapshotIds(strategy.metaSecondary).universeSnapshotId,
                  },
                  {
                    label: '回测编号',
                    render: (strategy: WorkspaceStrategyCardVM) => strategy.latestRunId ?? '-',
                  },
                ].map((row) => (
                  <tr key={row.label}>
                    <th scope="row">{row.label}</th>
                    {selectedStrategies.map((strategy) => (
                      <td key={`${row.label}-${strategy.id}`}>{row.render(strategy)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </section>
  );
}

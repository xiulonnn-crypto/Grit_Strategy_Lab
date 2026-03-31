import { useMemo, useState } from 'react';
import type { StrategyCompareCard, StrategyListItem } from '../types';

type WorkspaceStrategySectionProps = {
  strategies: Array<StrategyCompareCard | StrategyListItem>;
  loading?: boolean;
  error?: string | null;
  navigate: (path: string) => void;
  latestStrategy?: StrategyCompareCard | StrategyListItem;
  isMobile?: boolean;
  translateStatus?: (status: string) => string;
};

export function WorkspaceStrategySection({
  strategies,
  loading,
  error,
  navigate,
}: WorkspaceStrategySectionProps): JSX.Element {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const normalizedStrategies = useMemo(
    () =>
      strategies.map((strategy) => ({
        id: strategy.id,
        name: strategy.name,
        strategyType: 'strategyType' in strategy ? strategy.strategyType : 'MOMENTUM',
        universeName: 'universeName' in strategy ? strategy.universeName : 'SPY',
        parameterVersion: ('parameterVersion' in strategy ? strategy.parameterVersion : undefined) ?? 1,
        parameterVersionId: 'parameterVersionId' in strategy ? strategy.parameterVersionId : null,
        latestOptimizationJobId:
          'latestOptimizationJobId' in strategy ? (strategy.latestOptimizationJobId ?? null) : null,
        compareEligible: strategy.compareEligible ?? false,
        compareBlocker: strategy.compareBlocker ?? null,
        cardState: strategy.cardState ?? 'PENDING_RUN',
        parameters: 'parameters' in strategy ? strategy.parameters : {},
      })),
    [strategies],
  );

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
      <section className="panel">
        <div className="panel-header">
          <h3>Workspace Compare</h3>
        </div>
        <p className="empty-state">Loading strategy cards...</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="panel">
        <div className="panel-header">
          <h3>Workspace Compare</h3>
        </div>
        <div className="error-banner">{error}</div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Compare Cockpit</p>
          <h3>Stable Current-Version Strategies</h3>
          <p className="hero-copy">Pick 2 to 4 strategies. Locked cards explain why compare is disabled.</p>
        </div>
        <button
          className="ghost-button"
          disabled={selectedIds.length < 2}
          onClick={() => setCompareOpen(true)}
          type="button"
        >
          Open Compare
        </button>
      </div>

      <div className="workspace-card-grid">
        {normalizedStrategies.map((strategy) => {
          const disabled = !strategy.compareEligible || (!selectedIds.includes(strategy.id) && selectedIds.length >= 4);
          return (
            <article className="workspace-strategy-card" key={strategy.id}>
              <div className="workspace-card-header">
                <div>
                  <p className="eyebrow">{strategy.strategyType}</p>
                  <h4>{strategy.name}</h4>
                </div>
                <label className="compare-toggle">
                  <input
                    aria-label={`Select ${strategy.name} for compare`}
                    checked={selectedIds.includes(strategy.id)}
                    disabled={disabled}
                    onChange={() => toggleSelection(strategy.id)}
                    type="checkbox"
                  />
                  Compare
                </label>
              </div>
              <p className="workspace-card-copy">{strategy.universeName} · v{strategy.parameterVersion}</p>
              {strategy.compareBlocker ? <p className="workspace-card-warning">{strategy.compareBlocker}</p> : null}
              <div className="card-actions">
                <button className="text-button" onClick={() => navigate(`/strategies/${strategy.id}/backtest-runs/new`)} type="button">
                  Run Backtest
                </button>
                {strategy.latestOptimizationJobId ? (
                  <button className="text-button" onClick={() => navigate(`/optimization-jobs/${strategy.latestOptimizationJobId}`)} type="button">
                    Open Manual Lab
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {compareOpen ? (
        <div className="workspace-compare-panel" role="dialog" aria-label="Workspace compare panel">
          <div className="panel-header">
            <h3>Compare Cockpit</h3>
            <button className="text-button" onClick={() => setCompareOpen(false)} type="button">
              Close
            </button>
          </div>
          <div className="compare-grid">
            {selectedStrategies.map((strategy) => (
              <section className="compare-column" key={strategy.id}>
                <h4>{strategy.name}</h4>
                <p>Version {strategy.parameterVersion}</p>
                <p>{strategy.universeName}</p>
              </section>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

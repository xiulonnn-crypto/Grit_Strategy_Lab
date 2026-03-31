import { useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import type { StrategyType } from '../types';
import './creation-backtest.css';

const templates: Array<{ description: string; label: string; strategyType: StrategyType }> = [
  {
    label: 'Momentum Rotation',
    description: 'Restore a momentum session with universe, turnover, and allocation prompts.',
    strategyType: 'MOMENTUM',
  },
  {
    label: 'Grid Trading',
    description: 'Start a grid-based session and fill the missing execution parameters interactively.',
    strategyType: 'GRID',
  },
  {
    label: 'Mean Reversion',
    description: 'Use a mean reversion template and prepare the confirmation draft from real backend state.',
    strategyType: 'MEAN_REVERSION',
  },
  {
    label: 'Buy and Hold',
    description: 'Materialize a simple baseline strategy and continue into preview and backtest submission.',
    strategyType: 'BUY_AND_HOLD',
  },
];

export function CreationTemplatePage(): JSX.Element {
  const api = useApiClient();
  const [busyStrategyType, setBusyStrategyType] = useState<StrategyType | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreateSession(strategyType: StrategyType): Promise<void> {
    try {
      setBusyStrategyType(strategyType);
      setError(null);
      const session = await api.createCreationSession({ strategy_type: strategyType });
      navigateTo(`/creation/sessions/${session.id}`);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusyStrategyType(null);
    }
  }

  return (
    <div className="stack creation-template-page">
      <section className="hero-card">
        <div>
          <p className="eyebrow">Creation</p>
          <h2>Select a strategy template</h2>
          <p className="hero-copy">
            Foundation now routes real session creation to `#/creation/sessions/:id`. Worker 2 will extend
            this into the full restored conversation and confirmation flow.
          </p>
        </div>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      <section className="panel">
        <div className="panel-header">
          <h3>Available Templates</h3>
        </div>
        <div className="workspace-card-grid">
          {templates.map((template) => (
            <article className="workspace-strategy-card" key={template.strategyType}>
              <div>
                <p className="eyebrow">Template</p>
                <h4>{template.label}</h4>
              </div>
              <p className="workspace-card-copy">{template.description}</p>
              <div className="card-actions">
                <button
                  className="primary-button"
                  disabled={busyStrategyType !== null}
                  onClick={() => void handleCreateSession(template.strategyType)}
                  type="button"
                >
                  {busyStrategyType === template.strategyType ? 'Creating...' : 'Start Session'}
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

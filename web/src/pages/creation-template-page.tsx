import { useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import type { StrategyType } from '../types';
import './creation-backtest.css';

type TemplateCard = {
  strategyType: StrategyType;
  label: string;
  description: string;
};

const TEXT = {
  templateRegion: '策略模板',
  startSession: '使用此模板',
  creating: '创建中...',
} as const;

const templates: TemplateCard[] = [
  {
    strategyType: 'MOMENTUM',
    label: '动量 / 趋势跟随',
    description: '适合过去一段时间强势延续持有的轮动策略。',
  },
  {
    strategyType: 'GRID',
    label: '网格交易',
    description: '适合区间震荡，以规则化挂单分批买卖。',
  },
  {
    strategyType: 'MEAN_REVERSION',
    label: '均值回归',
    description: '适合偏离均值回归的交易框架。',
  },
  {
    strategyType: 'BUY_AND_HOLD',
    label: '指数 / 定投',
    description: '适合长期持有和固定节奏增持。',
  },
  {
    strategyType: 'GENERAL',
    label: '通用策略',
    description: '自定义规则，不强制固定模板参数。',
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
      {error ? <div className="error-banner">{error}</div> : null}

      <section
        aria-label={TEXT.templateRegion}
        className="creation-template-grid creation-template-grid--page"
      >
        {templates.map((template) => (
          <article className="creation-template-card" key={template.strategyType}>
            <div className="creation-template-card__body">
              <h3 className="creation-template-card__title">{template.label}</h3>
              <p className="creation-template-card__description">{template.description}</p>
            </div>
            <button
              className="primary-button"
              disabled={busyStrategyType !== null}
              onClick={() => void handleCreateSession(template.strategyType)}
              type="button"
            >
              {busyStrategyType === template.strategyType ? TEXT.creating : TEXT.startSession}
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}

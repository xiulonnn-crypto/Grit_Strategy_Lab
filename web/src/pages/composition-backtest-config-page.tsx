import { useEffect, useMemo, useState } from 'react';
import { navigateTo } from '../lib/appRouteContext';
import { useApiClient } from '../lib/demoStoreContext';
import {
  formatCompositionHeroCopy,
  formatCompositionName,
  formatCompositionStatusLabel,
  formatLegDisplayName,
} from '../lib/compose-display';
import type { ApiCompositionDetail, DemoApi } from '../types';
import './composition-backtest-config.css';

type CompositionBacktestConfigPageProps = {
  compositionId: string;
};

type CompositionBacktestClient = DemoApi & {
  createCompositionBacktestRun?: (
    compositionId: string,
    payload: Record<string, unknown>,
  ) => Promise<{ id?: string; run_id?: string }>;
};

const PERIODS = [
  { key: '10Y', label: '10Y', detail: '主验证周期' },
  { key: '20Y', label: '20Y', detail: '代理覆盖复核' },
  { key: '30Y', label: '30Y', detail: '长期压力观察' },
  { key: 'CUSTOM', label: '自定义', detail: '指定日期窗口' },
] as const;

const MISSING_DATA_RULES = [
  { key: 'proxy', label: '使用代理', detail: '缺口需记录相关度与来源' },
  { key: 'cash', label: '退回现金', detail: '保守处理不可验证窗口' },
  { key: 'block', label: '阻断运行', detail: '缺失数据不进入正式 run' },
] as const;

function formatPercentValue(value?: number | null, fallback = '暂无'): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  const normalized = Math.abs(value) <= 1 ? value * 100 : value;
  return `${normalized.toFixed(normalized >= 10 ? 0 : 1)}%`;
}

function getCoverage(detail: ApiCompositionDetail | null): string {
  const coverage = detail?.return_quality_summary?.coverage_pct;
  return formatPercentValue(coverage, '待计算');
}

function getBlockedSources(detail: ApiCompositionDetail | null): number {
  return (detail?.source_integrity ?? []).filter((item) => item.alerts.length > 0).length;
}

export function CompositionBacktestConfigPage({
  compositionId,
}: CompositionBacktestConfigPageProps): JSX.Element {
  const api = useApiClient() as CompositionBacktestClient;
  const [detail, setDetail] = useState<ApiCompositionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('10Y');
  const [rebalanceFrequency, setRebalanceFrequency] = useState('季度');
  const [driftThreshold, setDriftThreshold] = useState(8);
  const [feeBps, setFeeBps] = useState(1.5);
  const [slippageBps, setSlippageBps] = useState(2.5);
  const [missingDataRule, setMissingDataRule] = useState<(typeof MISSING_DATA_RULES)[number]['key']>('proxy');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      if (!api.getCompositionDetail) {
        setLoadError('当前运行时尚未接入组合详情接口。');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setLoadError(null);
        const response = await api.getCompositionDetail(compositionId);
        if (!cancelled) {
          setDetail(response);
        }
      } catch (caught) {
        if (!cancelled) {
          setLoadError(`加载组合失败：${(caught as Error).message}`);
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
  }, [api, compositionId]);

  const selectedPeriod = PERIODS.find((item) => item.key === period) ?? PERIODS[0];
  const blockedSources = getBlockedSources(detail);
  const canRun = !loading && !loadError && detail !== null && (missingDataRule !== 'block' || blockedSources === 0);

  const legs = useMemo(() => detail?.normalized_legs.slice(0, 4) ?? [], [detail]);

  async function handleSubmit(): Promise<void> {
    if (!detail) {
      return;
    }
    if (!api.createCompositionBacktestRun) {
      setSubmitError('组合回测接口尚未接入，无法创建正式 run。');
      return;
    }

    try {
      setSubmitting(true);
      setSubmitError(null);
      const response = await api.createCompositionBacktestRun(compositionId, {
        composition_version: detail.updated_at,
        period,
        rebalance_frequency: rebalanceFrequency,
        drift_threshold_pct: driftThreshold,
        fee_bps: feeBps,
        slippage_bps: slippageBps,
        missing_data_rule: missingDataRule,
      });
      const runId = response.run_id ?? response.id;
      if (!runId) {
        throw new Error('响应缺少 run id');
      }
      navigateTo(`/compositions/${encodeURIComponent(compositionId)}/backtest-runs/${encodeURIComponent(runId)}`);
    } catch (caught) {
      setSubmitError(`创建组合回测失败：${(caught as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="composition-backtest-config-page">
      <section className="composition-backtest-config-hero">
        <div>
          <span className="eyebrow">组合回测</span>
          <h1>稳定性配置</h1>
          <p>
            {detail
              ? formatCompositionHeroCopy({
                  description: detail.description,
                  legCount: detail.normalized_legs.length,
                  rebalanceFrequency: detail.rebalance_frequency,
                })
              : '选择验证周期、再平衡规则与数据门禁后生成正式组合 run。'}
          </p>
          <div className="composition-backtest-config-hero__chips">
            <span className="status-chip">{detail ? formatCompositionName({ name: detail.name }) : compositionId}</span>
            <span className="status-chip status-chip--soft">
              {detail ? formatCompositionStatusLabel(detail.status, detail.status_label) : '加载中'}
            </span>
            <span className="status-chip status-chip--soft">覆盖率 {getCoverage(detail)}</span>
          </div>
        </div>
        <div className="composition-backtest-config-hero__actions">
          <button className="ghost-button" onClick={() => navigateTo(`/compositions/${compositionId}`)} type="button">
            返回组合
          </button>
          <button className="primary-button" disabled={!canRun || submitting} onClick={handleSubmit} type="button">
            {submitting ? '创建中' : '运行回测'}
          </button>
        </div>
      </section>

      {loadError ? <div className="composition-backtest-config-alert">{loadError}</div> : null}
      {submitError ? <div className="composition-backtest-config-alert">{submitError}</div> : null}

      <section className="composition-backtest-config-grid">
        <div className="composition-backtest-config-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">01</span>
              <h2>选择验证周期</h2>
            </div>
            <span className="status-chip status-chip--soft">{selectedPeriod.detail}</span>
          </div>
          <div className="composition-backtest-config-periods">
            {PERIODS.map((item) => (
              <button
                className={`composition-backtest-config-choice${
                  item.key === period ? ' composition-backtest-config-choice--active' : ''
                }`}
                key={item.key}
                onClick={() => setPeriod(item.key)}
                type="button"
              >
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="composition-backtest-config-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">02</span>
              <h2>再平衡与成本</h2>
            </div>
            <span className="status-chip">偏离 {driftThreshold}%</span>
          </div>
          <div className="composition-backtest-config-fields">
            <label>
              <span>再平衡频率</span>
              <select value={rebalanceFrequency} onChange={(event) => setRebalanceFrequency(event.target.value)}>
                <option value="月度">月度</option>
                <option value="季度">季度</option>
                <option value="半年">半年</option>
                <option value="年度">年度</option>
              </select>
            </label>
            <label>
              <span>偏离阈值</span>
              <input
                max={20}
                min={1}
                onChange={(event) => setDriftThreshold(Number(event.target.value))}
                type="number"
                value={driftThreshold}
              />
            </label>
            <label>
              <span>手续费 bps</span>
              <input
                min={0}
                onChange={(event) => setFeeBps(Number(event.target.value))}
                step={0.1}
                type="number"
                value={feeBps}
              />
            </label>
            <label>
              <span>滑点 bps</span>
              <input
                min={0}
                onChange={(event) => setSlippageBps(Number(event.target.value))}
                step={0.1}
                type="number"
                value={slippageBps}
              />
            </label>
          </div>
        </div>

        <div className="composition-backtest-config-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">03</span>
              <h2>数据对齐规则</h2>
            </div>
            <span className={`status-chip${blockedSources ? ' status-chip--warning' : ' status-chip--soft'}`}>
              {blockedSources ? `${blockedSources} 项待复核` : '来源已锁定'}
            </span>
          </div>
          <div className="composition-backtest-config-periods">
            {MISSING_DATA_RULES.map((item) => (
              <button
                className={`composition-backtest-config-choice${
                  item.key === missingDataRule ? ' composition-backtest-config-choice--active' : ''
                }`}
                key={item.key}
                onClick={() => setMissingDataRule(item.key)}
                type="button"
              >
                <strong>{item.label}</strong>
                <span>{item.detail}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="composition-backtest-config-bottom">
        <div className="composition-backtest-config-panel">
          <div className="panel-header">
            <div>
              <span className="eyebrow">组合版本</span>
              <h2>当前权重摘要</h2>
            </div>
            <span className="status-chip status-chip--soft">{detail?.updated_at ?? '待加载'}</span>
          </div>
          <div className="composition-backtest-config-leg-list">
            {legs.map((leg) => (
              <div className="composition-backtest-config-leg" key={leg.id}>
                <div>
                  <strong>{formatLegDisplayName(leg)}</strong>
                  <span>{leg.version_label ?? leg.reference_summary}</span>
                </div>
                <b>{formatPercentValue(leg.weight_pct)}</b>
              </div>
            ))}
            {!legs.length && !loading ? <p className="composition-backtest-config-empty">暂无可验证组合腿。</p> : null}
          </div>
        </div>

        <aside className="composition-backtest-config-panel composition-backtest-config-precheck">
          <span className="eyebrow">预检</span>
          <h2>{canRun ? '可以生成正式 run' : '等待配置复核'}</h2>
          <div className="composition-backtest-config-precheck__grid">
            <span>周期</span>
            <strong>{selectedPeriod.label}</strong>
            <span>覆盖率</span>
            <strong>{getCoverage(detail)}</strong>
            <span>成本假设</span>
            <strong>{(feeBps + slippageBps).toFixed(1)} bps</strong>
            <span>数据规则</span>
            <strong>{MISSING_DATA_RULES.find((item) => item.key === missingDataRule)?.label}</strong>
          </div>
        </aside>
      </section>
    </main>
  );
}

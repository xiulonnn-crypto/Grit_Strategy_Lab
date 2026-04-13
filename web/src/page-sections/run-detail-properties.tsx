import type { ApiBacktestRunDetail } from '../types';
import { formatRunDetailKvLabel, formatRunDetailKvValue } from '../lib/run-detail-kv-format';
import { getRunDetailParameterSnapshot } from '../lib/run-detail-view-model';

type RunDetailPropertiesProps = {
  detail: ApiBacktestRunDetail;
};

function PropertiesCard({
  title,
  description,
  value,
}: {
  title: string;
  description: string;
  value: Record<string, unknown> | undefined;
}): JSX.Element {
  const entries = Object.entries(value ?? {});
  return (
    <section className="panel run-detail-property-card">
      <div className="panel-header">
        <div>
          <h3>{title}</h3>
          <p className="run-detail-section-copy">{description}</p>
        </div>
      </div>
      {entries.length ? (
        <div className="run-detail-kv-grid">
          {entries.map(([key, nextValue]) => (
            <div className="run-detail-kv-row" key={`${title}-${key}`}>
              <span>{formatRunDetailKvLabel(key)}</span>
              <strong>{formatRunDetailKvValue(key, nextValue)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-state">暂无数据。</p>
      )}
    </section>
  );
}

export function RunDetailPropertiesPanel({ detail }: RunDetailPropertiesProps): JSX.Element {
  return (
    <div className="run-detail-tab-panel">
      <div className="run-detail-properties-grid">
        <PropertiesCard
          description="当前回测请求的原始提交参数。"
          title="回测请求"
          value={detail.request}
        />
        <PropertiesCard
          description="实际执行所使用的参数快照，缺失项会补入运行配置上下文。"
          title="参数快照"
          value={getRunDetailParameterSnapshot(detail)}
        />
        <PropertiesCard
          description="当前运行绑定的数据集与快照信息。"
          title="数据快照摘要"
          value={detail.snapshot_summary ?? detail.preview?.snapshot_summary ?? undefined}
        />
        <PropertiesCard
          description="运行环境、执行模式及上下文信息。"
          title="环境摘要"
          value={detail.environment_summary ?? detail.preview?.environment_summary ?? undefined}
        />
      </div>
    </div>
  );
}

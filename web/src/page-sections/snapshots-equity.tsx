import { useState } from 'react';

type EquitySnapshotsTabProps = {
  onRefresh: () => void;
  refreshDisabled: boolean;
  refreshLabel: string;
};

type EquityFilter = 'all' | 'pending' | 'universe' | 'benchmark' | 'basket';

type EquitySnapshotRow = {
  id: string;
  title: string;
  summary: string;
  fields: string;
  schedule: string;
  status: 'ready' | 'pending';
  statusLabel: string;
  note: string;
  filter: EquityFilter;
};

const EQUITY_FILTERS: Array<{ id: EquityFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '仅看待补' },
  { id: 'universe', label: '股票 Universe' },
  { id: 'benchmark', label: '指数基准' },
  { id: 'basket', label: '权益篮子' },
];

const EQUITY_SNAPSHOT_ROWS: EquitySnapshotRow[] = [
  {
    id: 'Universe-US-Equity-20260401',
    title: 'Universe-US-Equity-20260401',
    summary: '股票清单 · 行业映射 + 公司行为审计',
    fields: 'OHLCV / 公司行为 / 行业 / 代码映射',
    schedule: 'Yahoo + Corporate Audit · 日终（EOD） 03:48 EST',
    status: 'pending',
    statusLabel: '待补',
    note: '缺少行业标签 8 条，建议从 FMP 重新同步映射。',
    filter: 'universe',
  },
  {
    id: 'Benchmarks-Core-20260401',
    title: 'Benchmarks-Core-20260401',
    summary: 'SPY / QQQ / TLT / GLD / VIX',
    fields: '基准序列 / 对照标签 / 展示元数据',
    schedule: 'FMP · 日终（EOD） 03:48 EST',
    status: 'ready',
    statusLabel: '就绪',
    note: '全部对齐，可直接用于策略对照、工作站观察和报告页引用。',
    filter: 'benchmark',
  },
  {
    id: 'Theme-Alpha-Basket-20260401',
    title: 'Theme-Alpha-Basket-20260401',
    summary: '主题篮子 · 资产腿可选来源',
    fields: '篮子权重 / 成分股列表 / 最近一次证明',
    schedule: '人工补录 + 日终校验',
    status: 'pending',
    statusLabel: '待补',
    note: '缺少昨日权重快照，当前无法回测，也不建议直接复用为正式资产腿。',
    filter: 'basket',
  },
];

function shouldShowRow(row: EquitySnapshotRow, activeFilter: EquityFilter): boolean {
  if (activeFilter === 'all') {
    return true;
  }
  if (activeFilter === 'pending') {
    return row.status === 'pending';
  }
  return row.filter === activeFilter;
}

function filterButtonClassName(filter: EquityFilter, activeFilter: EquityFilter): string {
  return `filter-chip ${filter === activeFilter ? 'filter-chip--active' : ''}`.trim();
}

function statusChipClassName(status: EquitySnapshotRow['status']): string {
  return status === 'ready' ? 'status-chip status-chip--success' : 'status-chip status-chip--warning';
}

export function EquitySnapshotsTab({
  onRefresh,
  refreshDisabled,
  refreshLabel,
}: EquitySnapshotsTabProps): JSX.Element {
  const [activeFilter, setActiveFilter] = useState<EquityFilter>('all');
  const visibleRows = EQUITY_SNAPSHOT_ROWS.filter((row) => shouldShowRow(row, activeFilter));

  function jumpToIssues(filter: EquityFilter = 'pending'): void {
    setActiveFilter(filter);
    window.requestAnimationFrame(() => {
      const target = document.getElementById('equity-issues-list');
      target?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    });
  }

  return (
    <div className="snapshots-equity-view">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>全局视角</h2>
            <p className="panel-note">
              顶部只保留“结果”，不再解释“过程”。研究员扫一眼就能知道今天行不行，只需要注意没有达到 100% 的项目。
            </p>
          </div>
          <button
            className="primary-button"
            disabled={refreshDisabled}
            onClick={onRefresh}
            type="button"
          >
            {refreshLabel}
          </button>
        </div>
        <div className="metric-grid">
          <div className="metric-card metric-card--accent">
            <span>股票快照</span>
            <strong>99.8% 就绪</strong>
            <small>例外已经收敛到少量待审计项，不再把长数字放到第一视觉。</small>
          </div>
          <div className="metric-card metric-card--accent">
            <span>指数基准</span>
            <strong>100% 就绪</strong>
            <small>✓ 全部对齐，今天不需要额外关注这一层。</small>
          </div>
          <div className="metric-card metric-card--warning">
            <span>权益篮子</span>
            <strong>80% 可用</strong>
            <small>⚠ 仍有 1 个篮子未达回测资格，是本页当前最值得注意的例外。</small>
          </div>
          <div className="metric-card metric-card--warning">
            <span>异常队列</span>
            <strong>2 项例外</strong>
            <small>只要盯住未达 100% 的卡片即可，这就是“管理例外”。</small>
          </div>
          <div className="metric-card">
            <span>最新刷新（EST）</span>
            <strong>03:48</strong>
            <small>今日快照已完成统一写入，可直接基于结果判断是否继续工作。</small>
          </div>
        </div>
      </section>

      <div className="detail-grid">
        <div className="detail-main">
          <section className="panel">
            <div className="panel-header">
              <div>
                <h2>三位一体工作站</h2>
                <p className="panel-note">
                  这里保留“数量”，并且增加“行动”。数字用于判断能不能立刻建资产腿，红色待审计链接则直接把你送到待修问题清单。
                </p>
              </div>
            </div>
            <div className="bond-core-grid">
              <article className="bond-core-card">
                <div className="source-head">
                  <div>
                    <strong>股票 Universe</strong>
                    <p>股票清单、行业映射与公司行为审计都在这里收口，是整个研究入口的基础库存。</p>
                  </div>
                  <a
                    className="status-chip status-chip--danger audit-link"
                    href="#equity-issues-list"
                    onClick={(event) => {
                      event.preventDefault();
                      jumpToIssues('pending');
                    }}
                  >
                    8 待审计
                  </a>
                </div>
                <article className="progress-shell">
                  <div className="progress-meta">
                    <span>5,120 就绪 / 5,128 总数</span>
                    <span>点击红色待审计链接后，仅看异常记录</span>
                  </div>
                  <div className="progress-bar">
                    <span className="progress-fill" style={{ width: '99.84%' }} />
                  </div>
                </article>
                <ul>
                  <li>角色：多因子实验室、工作站与筛选器的统一股票底座。</li>
                  <li>状态：仍有 8 条股票缺行业标签；如果现在要镜像生成资产腿，建议先清理这一层。</li>
                </ul>
              </article>

              <article className="bond-core-card">
                <div className="source-head">
                  <div>
                    <strong>指数与基准</strong>
                    <p>SPY、QQQ、TLT、GLD、VIX 以及研究口径下的核心对照对象都集中在这里维护。</p>
                  </div>
                  <span className="status-chip status-chip--success">12 Ready</span>
                </div>
                <article className="progress-shell">
                  <div className="progress-meta">
                    <span>12 就绪 / 12 总数</span>
                    <span>基准面已封板，可直接沿用</span>
                  </div>
                  <div className="progress-bar">
                    <span className="progress-fill" style={{ width: '100%' }} />
                  </div>
                </article>
                <ul>
                  <li>角色：详情页、回测分析与工作台共用的观察和对照对象。</li>
                  <li>状态：全部对齐，可继续作为收益曲线和策略对照的默认基准。</li>
                </ul>
              </article>

              <article className="bond-core-card">
                <div className="source-head">
                  <div>
                    <strong>权益篮子</strong>
                    <p>主题 ETF、因子篮子与资产腿复用的权益库存都保留在一个可审计的快照来源里。</p>
                  </div>
                  <a
                    className="status-chip status-chip--warning audit-link"
                    href="#equity-issues-list"
                    onClick={(event) => {
                      event.preventDefault();
                      jumpToIssues('pending');
                    }}
                  >
                    1 Pending
                  </a>
                </div>
                <article className="progress-shell">
                  <div className="progress-meta">
                    <span>4 就绪 / 5 总数</span>
                    <span>Theme-Alpha-Basket 仍待补昨日权重</span>
                  </div>
                  <div className="progress-bar">
                    <span className="progress-fill" style={{ width: '80%' }} />
                  </div>
                </article>
                <ul>
                  <li>角色：资产腿与正式组合的通用权益来源。</li>
                  <li>状态：仍有 1 组旧篮子待补权重证明，点击 Pending 后应直接跳到问题清单修补。</li>
                </ul>
              </article>
            </div>
          </section>

          <section className="panel" id="equity-issues-list">
            <div className="panel-header">
              <div>
                <h2>原始快照清单</h2>
                <p className="panel-note">
                  待补标签必须告诉研究员“为什么不就绪”。这里保留高密度列表，并在状态旁直接写出缺失维度，例如行业映射缺口、权重证明待补或成分覆盖不足。
                </p>
              </div>
            </div>
            <div className="toolbar" aria-label="股票快照过滤">
              {EQUITY_FILTERS.map((filter) => (
                <button
                  aria-pressed={activeFilter === filter.id}
                  className={filterButtonClassName(filter.id, activeFilter)}
                  key={filter.id}
                  onClick={() => {
                    setActiveFilter(filter.id);
                  }}
                  type="button"
                >
                  {filter.label}
                </button>
              ))}
            </div>
            <div className="drawer-callout">
              默认展示全部快照；点击中部红色待审计或 Pending 链接后，列表会自动滚动到这里，并切换到“仅看待补”模式。
            </div>
            <div className="bond-snapshot-table">
              {visibleRows.map((row) => (
                <article className="bond-snapshot-row" key={row.id}>
                  <div className="bond-snapshot-row__cell">
                    <strong>{row.title}</strong>
                    <span>{row.summary}</span>
                  </div>
                  <div className="bond-snapshot-row__cell">
                    <strong>字段</strong>
                    <span>{row.fields}</span>
                  </div>
                  <div className="bond-snapshot-row__cell">
                    <strong>调度</strong>
                    <span>{row.schedule}</span>
                  </div>
                  <div className="bond-snapshot-row__cell">
                    <strong>状态</strong>
                    <span>
                      <span className={statusChipClassName(row.status)}>{row.statusLabel}</span>
                    </span>
                    <span>{row.note}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>

        <aside className="detail-rail">
          <section className="rail-panel">
            <h2>数据诊断报告</h2>
            <div className="evidence-list">
              <article className="evidence-card">
                <strong>股票 Universe</strong>
                <span>异常项：8 条数据缺少行业标签，建议从 FMP 重新同步映射，再回到工作站确认镜像资格。</span>
              </article>
              <article className="evidence-card">
                <strong>权益篮子</strong>
                <span>缺失项：Theme-Alpha-Basket 缺少昨日权重快照，将导致无法回测，也不能安全生成资产腿。</span>
              </article>
              <article className="evidence-card">
                <strong>指数与基准</strong>
                <span>当前无异常，可继续作为工作站、回测分析与报告页的默认观察面。</span>
              </article>
            </div>
            <div className="drawer-callout">这里不重复报数，只解释数字背后的原因和建议动作，让右侧栏真正像“说明书”和“医生意见”。</div>
          </section>

          <section className="rail-panel">
            <h2>就绪标准</h2>
            <div className="evidence-list">
              <article className="evidence-card">
                <strong>基础就绪</strong>
                <span>OHLCV 数据完整，基础元数据可落库，至少能被页面正确展示和引用。</span>
              </article>
              <article className="evidence-card">
                <strong>投研就绪</strong>
                <span>公司行为（复权因子）已审计，行业分类与映射完成，可以进入研究筛选与相对比较。</span>
              </article>
              <article className="evidence-card">
                <strong>组合就绪</strong>
                <span>通过一致性校验，可镜像生成资产腿或正式组合，不会在下游计算里引入口径漂移。</span>
              </article>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

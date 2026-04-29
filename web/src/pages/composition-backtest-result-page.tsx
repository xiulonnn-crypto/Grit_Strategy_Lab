import { useEffect, useMemo, useState } from 'react';
import { useApiClient } from '../lib/demoStoreContext';
import type { ApiCompositionBacktestOrder, ApiCompositionBacktestRun } from '../types';
import './composition-backtest-result.css';

type ResultTab = 'diagnosis' | 'orders' | 'evidence';
type OrderMode = 'events' | 'ledger';
type ExportFormat = 'csv' | 'excel';

type Tone = 'good' | 'warning' | 'danger' | 'info' | 'neutral';

type CompositionBacktestResultPageProps = {
  compositionId: string;
  runId: string;
  data?: unknown;
  initialTab?: ResultTab;
  initialOrderMode?: OrderMode;
  highlightedEventId?: string;
  highlightedOrderId?: string;
  onRerunBacktest?: (compositionId: string, runId: string) => void;
  onStartOptimization?: (compositionId: string, runId: string) => void;
  onExportLedger?: (format: ExportFormat, result: CompositionBacktestResult) => void;
};

type PerformanceMetric = {
  key: string;
  label: string;
  tenYear: string;
  twentyYear: string;
  thirtyYear: string;
  conclusion: string;
  proxyNote?: string;
};

type PerformanceComparison = {
  key: string;
  label: string;
  status: string;
  tone: Tone;
  rows: Array<{
    key: string;
    label: string;
    value: string;
    conclusion: string;
    proxyNote?: string;
    weak: boolean;
  }>;
};

type HeroMetric = {
  key: string;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
};

type SleeveContribution = {
  key: string;
  name: string;
  primary: string;
  detail: string;
  efficiency: string;
  tone: Tone;
  valuePct: number;
};

type ExposureRow = {
  key: string;
  period: string;
  alphaPct: number;
  qqqPct: number;
  billPct: number;
  cashPct: number;
  label: string;
  note?: string;
};

type StressZoom = {
  label: string;
  portfolioDrawdown: string;
  benchmarkLabel: string;
  benchmarkDrawdown: string;
  timeToRecovery: string;
  note: string;
};

type ConcentrationHolding = {
  symbol: string;
  detail: string;
  weightPct: number;
  tone: Tone;
};

type DiagnosisJump = {
  id: string;
  title: string;
  body: string;
  eventId?: string;
  orderId?: string;
};

type NettingDetail = {
  title: string;
  rawSellDemand: string;
  rawBuyDemand: string;
  internalMatch: string;
  externalQuantity: string;
  explanation: string;
};

type CompositionOrder = {
  id: string;
  time: string;
  symbol: string;
  side: string;
  quantity: string;
  price: string;
  slippageBps: string;
  fee: string;
  sleeve: string;
  triggerReason: string;
  nettingLabel: string;
  tone: Tone;
  netting?: NettingDetail;
};

type RebalanceEvent = {
  id: string;
  title: string;
  totalAmount: string;
  frictionCost: string;
  triggerReason: string;
  effectiveness: string;
  orders: CompositionOrder[];
};

type EfficiencyRow = {
  id: string;
  event: string;
  trigger: string;
  contribution: string;
  slippage: string;
  fee: string;
  detailLabel: string;
};

type EvidenceCard = {
  id: string;
  title: string;
  body: string;
  tone: Tone;
};

type ProxyLog = {
  id: string;
  period: string;
  missingSleeve: string;
  proxy: string;
  correlation: string;
  usage: string;
};

type AuditEntry = {
  id: string;
  title: string;
  body: string;
  at?: string;
};

type CompositionBacktestResult = {
  compositionId: string;
  runId: string;
  title: string;
  subtitle: string;
  statusChips: string[];
  stabilityRuling: string;
  stabilityDetail: string;
  proxyCoverageNote: string;
  exposureAuditNote: string;
  performanceMatrix: PerformanceMetric[];
  sleeveContributions: SleeveContribution[];
  exposureRows: ExposureRow[];
  stressZoom: StressZoom;
  concentrationTop5: ConcentrationHolding[];
  diagnosisJumps: DiagnosisJump[];
  events: RebalanceEvent[];
  ledgerRows: CompositionOrder[];
  efficiencyRows: EfficiencyRow[];
  evidenceCards: EvidenceCard[];
  proxyLogs: ProxyLog[];
  auditTrail: AuditEntry[];
};

const DEFAULT_RESULT: CompositionBacktestResult = {
  compositionId: 'composition',
  runId: 'run',
  title: '组合回测结果',
  subtitle: '诊断、订单与证据分层查看，聚焦稳定性、执行合理性与来源可信度。',
  statusChips: ['正式运行记录', '诊断分层', '审计留痕'],
  stabilityRuling: '稳定性裁决：10Y 稳定，20Y 需复核',
  stabilityDetail: '净收益 11.8%，最大回撤 -9.4%，成本拖累 18 bps；30Y 数据不足，不纳入正式裁决。',
  proxyCoverageNote: '20Y 指标含 SPY 代理覆盖说明：2006-2011 Alpha Core 缺失，相关度 0.98，仅用于方向复核。',
  exposureAuditNote: '敞口热力图按组合再平衡事件生成；保存组合保留冻结来源证据，模拟不会改写组合腿。',
  performanceMatrix: [
    {
      key: 'annualized_return',
      label: '年化收益',
      tenYear: '12.0%',
      twentyYear: '8.9%',
      thirtyYear: '不足',
      conclusion: '10Y 有效，20Y 需复核。',
      proxyNote: '20Y 含 SPY 代理覆盖。',
    },
    {
      key: 'sharpe_sortino',
      label: '夏普 / 索提诺',
      tenYear: '1.21 / 1.68',
      twentyYear: '0.94 / 1.22',
      thirtyYear: '不足',
      conclusion: '收益质量稳定。',
      proxyNote: '20Y 代理仅作方向判断。',
    },
    {
      key: 'drawdown_recovery',
      label: '最大回撤 / 修复天数',
      tenYear: '-9.4% / 96d',
      twentyYear: '-15.2% / 184d',
      thirtyYear: '不足',
      conclusion: '20Y 尾部风险较高。',
    },
    {
      key: 'vol_beta',
      label: '波动率 / Beta',
      tenYear: '7.8% / 0.74',
      twentyYear: '9.6% / 0.82',
      thirtyYear: '不足',
      conclusion: 'Beta 控制有效。',
    },
    {
      key: 'ir_te',
      label: 'IR / Tracking Error',
      tenYear: '0.62 / 4.8%',
      twentyYear: '0.41 / 6.1%',
      thirtyYear: '不足',
      conclusion: '相对收益仍需看订单成本。',
    },
  ],
  sleeveContributions: [
    {
      key: 'alpha-core',
      name: 'Alpha Core',
      primary: '主收益',
      detail: '收益 +12.4%，Alpha +3.8%，回撤贡献 38%。',
      efficiency: '0.33x',
      tone: 'good',
      valuePct: 68,
    },
    {
      key: 'qqq-grid',
      name: 'QQQ Grid',
      primary: '水下偏高',
      detail: '收益 +4.1%，Beta 0.52，水下贡献 44%。',
      efficiency: '0.09x',
      tone: 'warning',
      valuePct: 44,
    },
    {
      key: 'tbill-cash',
      name: 'T-Bill + Cash',
      primary: '避震腿',
      detail: '回撤缓冲 +6.6pt，2022 Q1 权重升至 46%。',
      efficiency: '防守',
      tone: 'info',
      valuePct: 31,
    },
  ],
  exposureRows: [
    { key: '2016', period: '2016', alphaPct: 44, qqqPct: 28, billPct: 18, cashPct: 10, label: '定期平衡' },
    { key: '2020', period: '2020', alphaPct: 35, qqqPct: 20, billPct: 33, cashPct: 12, label: '回撤触发' },
    { key: '2022', period: '2022', alphaPct: 28, qqqPct: 14, billPct: 46, cashPct: 12, label: '回撤触发' },
    { key: '2024', period: '2024', alphaPct: 38, qqqPct: 22, billPct: 30, cashPct: 10, label: '定期平衡' },
  ],
  stressZoom: {
    label: '压力窗口 · 2020 疫情',
    portfolioDrawdown: '-5.8%',
    benchmarkLabel: 'QQQ',
    benchmarkDrawdown: '-15.6%',
    timeToRecovery: '组合 42 天，QQQ 93 天',
    note: '压力窗口用于缩放复核组合与 QQQ 的跌幅、修复时间和失效来源。',
  },
  concentrationTop5: [
    { symbol: 'NVDA', detail: 'Alpha Core 8.4% + QQQ Grid 7.2%', weightPct: 15.6, tone: 'warning' },
    { symbol: 'MSFT', detail: 'Alpha Core 6.1% + QQQ Grid 4.4%', weightPct: 10.5, tone: 'neutral' },
    { symbol: 'AAPL', detail: 'QQQ Grid 8.8%', weightPct: 8.8, tone: 'neutral' },
    { symbol: 'AMZN', detail: 'Alpha Core 4.6% + QQQ Grid 3.7%', weightPct: 8.3, tone: 'neutral' },
    { symbol: 'GOOGL', detail: 'QQQ Grid 6.9%', weightPct: 6.9, tone: 'neutral' },
  ],
  diagnosisJumps: [
    {
      id: 'jump-2022-q1',
      title: '2022 Q1 避震收益 +3.2pt',
      body: 'T-Bill 权重升至 46%，需要核对回撤保护订单。',
      eventId: 'event-2022-q1',
      orderId: 'order-2022-qqq',
    },
    {
      id: 'jump-qqq-drift',
      title: 'QQQ 偏离触发占 42%',
      body: '建议复核 5% 偏离阈值与内部对冲比例。',
      eventId: 'event-2024-q1',
      orderId: 'order-2024-qqq',
    },
  ],
  events: [
    {
      id: 'event-2024-q1',
      title: '2024-03-31 定期再平衡',
      totalAmount: '$1.84M',
      frictionCost: '7 bps',
      triggerReason: '季度再平衡',
      effectiveness: '+0.6pt',
      orders: [
        {
          id: 'order-2024-tbill',
          time: '2024-03-31',
          symbol: 'T-Bill 3M',
          side: 'Buy',
          quantity: '4,300',
          price: '99.42',
          slippageBps: '1.2',
          fee: '26.00',
          sleeve: 'T-Bill',
          triggerReason: '季度再平衡',
          nettingLabel: '外部成交',
          tone: 'info',
        },
        {
          id: 'order-2024-qqq',
          time: '2024-03-31',
          symbol: 'QQQ',
          side: 'Sell',
          quantity: '20',
          price: '362.18',
          slippageBps: '3.1',
          fee: '18.40',
          sleeve: 'QQQ Grid',
          triggerReason: '季度再平衡 / 内部对冲后',
          nettingLabel: '内部对冲 42%',
          tone: 'good',
          netting: {
            title: 'QQQ 内部对冲穿透',
            rawSellDemand: 'Alpha Core 原始卖出 100 股',
            rawBuyDemand: 'QQQ Grid 原始买入 80 股',
            internalMatch: '内部撮合 80 股',
            externalQuantity: '最终外部成交 20 股',
            explanation: '系统先在组合内部撮合买卖需求，剩余差额才进入外部成交，避免把所有调仓误判为市场冲击。',
          },
        },
        {
          id: 'order-2024-msft',
          time: '2024-03-31',
          symbol: 'MSFT',
          side: 'Buy',
          quantity: '42',
          price: '417.26',
          slippageBps: '2.9',
          fee: '14.90',
          sleeve: 'Alpha Core',
          triggerReason: '季度再平衡',
          nettingLabel: '内部对冲 18%',
          tone: 'good',
        },
      ],
    },
    {
      id: 'event-2022-q1',
      title: '2022-03-31 回撤保护',
      totalAmount: '$2.42M',
      frictionCost: '8 bps',
      triggerReason: '回撤触发',
      effectiveness: '+3.2pt',
      orders: [
        {
          id: 'order-2022-qqq',
          time: '2022-03-31',
          symbol: 'QQQ',
          side: 'Sell',
          quantity: '118',
          price: '361.83',
          slippageBps: '4.8',
          fee: '42.70',
          sleeve: 'QQQ Grid',
          triggerReason: '回撤保护',
          nettingLabel: '外部成交',
          tone: 'warning',
        },
        {
          id: 'order-2022-tbill',
          time: '2022-03-31',
          symbol: 'T-Bill 3M',
          side: 'Buy',
          quantity: '4,300',
          price: '99.18',
          slippageBps: '1.2',
          fee: '26.00',
          sleeve: 'T-Bill',
          triggerReason: '回撤保护',
          nettingLabel: '外部成交',
          tone: 'info',
        },
      ],
    },
    {
      id: 'event-2020-q1',
      title: '2020-03-31 风险归位',
      totalAmount: '$1.16M',
      frictionCost: '6 bps',
      triggerReason: '波动超阈',
      effectiveness: '+2.1pt',
      orders: [
        {
          id: 'order-2020-nvda',
          time: '2020-03-31',
          symbol: 'NVDA',
          side: 'Sell',
          quantity: '36',
          price: '63.42',
          slippageBps: '6.2',
          fee: '12.10',
          sleeve: 'Alpha Core',
          triggerReason: '波动超阈',
          nettingLabel: '冲击成本高',
          tone: 'warning',
        },
      ],
    },
  ],
  ledgerRows: [
    {
      id: 'ledger-2024-qqq',
      time: '2024-03-31',
      symbol: 'QQQ',
      side: 'Sell',
      quantity: '20',
      price: '362.18',
      slippageBps: '3.1',
      fee: '18.40',
      sleeve: 'QQQ Grid',
      triggerReason: '季度再平衡 / 内部对冲后',
      nettingLabel: '内部对冲 42%',
      tone: 'good',
    },
    {
      id: 'ledger-2023-qqq',
      time: '2023-12-29',
      symbol: 'QQQ',
      side: 'Buy',
      quantity: '64',
      price: '409.52',
      slippageBps: '2.4',
      fee: '31.12',
      sleeve: 'QQQ Grid',
      triggerReason: '偏离阈值',
      nettingLabel: '外部成交',
      tone: 'good',
    },
    {
      id: 'ledger-2022-qqq',
      time: '2022-03-31',
      symbol: 'QQQ',
      side: 'Sell',
      quantity: '118',
      price: '361.83',
      slippageBps: '4.8',
      fee: '42.70',
      sleeve: 'QQQ Grid',
      triggerReason: '回撤保护',
      nettingLabel: '外部成交',
      tone: 'warning',
    },
    {
      id: 'ledger-2022-tbill',
      time: '2022-03-31',
      symbol: 'T-Bill 3M',
      side: 'Buy',
      quantity: '4,300',
      price: '99.18',
      slippageBps: '1.2',
      fee: '26.00',
      sleeve: 'T-Bill',
      triggerReason: '回撤保护',
      nettingLabel: '外部成交',
      tone: 'info',
    },
    {
      id: 'ledger-2020-nvda',
      time: '2020-03-31',
      symbol: 'NVDA',
      side: 'Sell',
      quantity: '36',
      price: '63.42',
      slippageBps: '6.2',
      fee: '12.10',
      sleeve: 'Alpha Core',
      triggerReason: '波动超阈',
      nettingLabel: '冲击成本高',
      tone: 'warning',
    },
    {
      id: 'ledger-2020-msft',
      time: '2020-03-31',
      symbol: 'MSFT',
      side: 'Buy',
      quantity: '42',
      price: '157.71',
      slippageBps: '2.9',
      fee: '14.90',
      sleeve: 'Alpha Core',
      triggerReason: '风险归位',
      nettingLabel: '内部对冲 18%',
      tone: 'good',
    },
  ],
  efficiencyRows: [
    {
      id: 'eff-2022-q1',
      event: '2022 Q1',
      trigger: '回撤保护',
      contribution: '+3.2pt',
      slippage: '4 bps',
      fee: '4 bps',
      detailLabel: '已定位',
    },
    {
      id: 'eff-2023-q2',
      event: '2023 Q2',
      trigger: '风险贡献超阈',
      contribution: '风险回落 9pt',
      slippage: '4 bps',
      fee: '2 bps',
      detailLabel: '展开',
    },
    {
      id: 'eff-2024-q4',
      event: '2024 Q4',
      trigger: 'QQQ 偏离 +6.2%',
      contribution: '+1.1pt',
      slippage: '3 bps',
      fee: '1 bps',
      detailLabel: '展开',
    },
  ],
  evidenceCards: [
    {
      id: 'frozen-config',
      title: '配置冻结',
      body: '组合 v1.2；Alpha Core v5；QQQ Grid v4；T-Bill Snapshot 2026-03。',
      tone: 'good',
    },
    {
      id: 'data-footprint',
      title: '数据足迹',
      body: '价格序列来自正式行情源；现金曲线锁定 UST 3M。',
      tone: 'info',
    },
    {
      id: 'proxy-logs',
      title: '代理日志',
      body: '2006-2011 Alpha Core 缺失，使用 SPY 代理，相关度 0.98。',
      tone: 'warning',
    },
    {
      id: 'algorithm-spec',
      title: '算法规则',
      body: '季度再平衡；5% 偏离阈值；成本 6 / 8 bps；缺失数据采用严格门禁与代理映射。',
      tone: 'neutral',
    },
  ],
  proxyLogs: [
    {
      id: 'proxy-alpha-spy',
      period: '2006-2011',
      missingSleeve: 'Alpha Core v5',
      proxy: 'SPY',
      correlation: '0.98',
      usage: '20Y 方向参考',
    },
    {
      id: 'proxy-qqq-ndx',
      period: '2008-2009',
      missingSleeve: 'QQQ Grid v4',
      proxy: 'Nasdaq 100',
      correlation: '0.96',
      usage: '压力窗禁正式归因',
    },
    {
      id: 'proxy-tbill',
      period: '2010-2012',
      missingSleeve: 'T-Bill Snapshot',
      proxy: 'UST 3M',
      correlation: '0.99',
      usage: '现金收益补齐',
    },
  ],
  auditTrail: [
    {
      id: 'audit-run',
      title: 'run_20260428_1412',
      body: '由 v1.2 正式版创建，配置指纹 8f2c-91aa。',
      at: '2026-04-28 14:12',
    },
    {
      id: 'audit-data-gate',
      title: '数据门禁',
      body: '10Y 通过；20Y 代理覆盖 12%；30Y 阻塞。',
    },
    {
      id: 'audit-algo-lock',
      title: '算法锁定',
      body: '成本 6 / 8 bps，季度再平衡，偏离阈值 5%。',
    },
  ],
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getValue(source: Record<string, unknown> | null, keys: string[]): unknown {
  if (!source) {
    return undefined;
  }
  for (const key of keys) {
    if (key in source) {
      return source[key];
    }
  }
  return undefined;
}

function getRecord(source: Record<string, unknown> | null, keys: string[]): Record<string, unknown> | null {
  return asRecord(getValue(source, keys));
}

function toText(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toTone(value: unknown, fallback: Tone): Tone {
  return value === 'good' || value === 'warning' || value === 'danger' || value === 'info' || value === 'neutral'
    ? value
    : fallback;
}

function humanizeRuntimeLabel(value: unknown, fallback: string): string {
  const text = toText(value, fallback);
  if (/^proxy evidence required$/i.test(text)) {
    return '需要代理证据复核';
  }
  if (/^composition[_\s-]*detail[_\s-]*preview$/i.test(text)) {
    return '组合详情预演';
  }
  if (/^Derived from saved composition preview\/detail fields; this is not real broker execution history\.?$/i.test(text)) {
    return '来自组合预演/详情字段推导，并非真实券商成交历史。';
  }
  if (/^Derived from full-window composition rebalance events and source return streams; these are model instructions, not broker fills\.?$/i.test(text)) {
    return '来自全窗口组合调仓事件与来源收益流；这是模型指令，不是券商成交回报。';
  }
  if (/^proxy_from_composition_detail_preview$/i.test(text)) {
    return '组合详情代理投影';
  }
  if (/^verified_from_composition_detail_preview$/i.test(text)) {
    return '组合详情已验证';
  }
  if (/^limited_from_composition_detail_preview$/i.test(text)) {
    return '组合详情有限覆盖';
  }
  if (/^quarterly$/i.test(text)) {
    return '季度';
  }
  if (/^monthly$/i.test(text)) {
    return '每月';
  }
  if (/^semiannual$/i.test(text)) {
    return '半年';
  }
  if (/^completed_with_warnings$/i.test(text)) {
    return '完成但需复核';
  }
  if (/^completed$/i.test(text)) {
    return '已完成';
  }
  if (/^10Y stable$/i.test(text)) {
    return '10Y 样本稳定';
  }
  if (/^limited window$/i.test(text)) {
    return '样本窗口有限';
  }
  const simulatedAlignedMatch = text.match(/^Simulated from ([a-z_ -]+) cadence using aligned leg return streams\.?$/i);
  if (simulatedAlignedMatch?.[1]) {
    return `按${humanizeRuntimeLabel(simulatedAlignedMatch[1], '定期')}节奏和已对齐的腿收益流模拟。`;
  }
  const simulatedLimitedMatch = text.match(/^Simulated from ([a-z_ -]+) cadence with limited drift evidence\.?$/i);
  if (simulatedLimitedMatch?.[1]) {
    return `按${humanizeRuntimeLabel(simulatedLimitedMatch[1], '定期')}节奏模拟，漂移证据有限。`;
  }
  if (/^Simulated from quarterly cadence using aligned leg return streams\.?$/i.test(text)) {
    return '按季度节奏和已对齐的腿收益流模拟。';
  }
  if (/^Saved compositions keep frozen source evidence; rebalance simulation does not mutate legs\.?$/i.test(text)) {
    return '保存组合保留冻结来源证据；调仓模拟不改写组合腿。';
  }
  if (/^Composition record created with normalized legs and cost policy\.?$/i.test(text)) {
    return '组合记录已创建，组合腿与成本规则已标准化。';
  }
  if (/^Composition structure, weights, benchmark, or cost policy was patched and revalidated\.?$/i.test(text)) {
    return '组合结构、权重、基准或成本规则已更新并重新校验。';
  }
  const sourceFreezeMatch = text.match(/^Captured\s+(\d+)\s+source freeze signatures\.?$/i);
  if (sourceFreezeMatch?.[1]) {
    return `已记录 ${sourceFreezeMatch[1]} 条来源冻结签名。`;
  }
  const rebalanceSummaryMatch = text.match(/^Simulated\s+(\d+)\s+rebalance events without mutating frozen sources\.?$/i);
  if (rebalanceSummaryMatch?.[1]) {
    return `已模拟 ${rebalanceSummaryMatch[1]} 次调仓事件，未改写冻结来源。`;
  }
  const statusSummaryMatch = text.match(/^Composition status is ([A-Z_ -]+); drift warnings remain advisory\.?$/i);
  if (statusSummaryMatch?.[1]) {
    return `组合状态为${humanizeRuntimeLabel(statusSummaryMatch[1], statusSummaryMatch[1])}；漂移预警保持为建议项。`;
  }
  const cadenceModeledMatch = text.match(/^Cadence modeled as ([a-z_ -]+)\.?$/i);
  if (cadenceModeledMatch?.[1]) {
    return `调仓频率按${humanizeRuntimeLabel(cadenceModeledMatch[1], cadenceModeledMatch[1])}建模。`;
  }
  if (/^created$/i.test(text)) {
    return '创建记录';
  }
  if (/^structure_patch$/i.test(text)) {
    return '结构更新';
  }
  if (/^source_freeze$/i.test(text)) {
    return '来源冻结';
  }
  if (/^rebalance_check$/i.test(text)) {
    return '调仓校验';
  }
  if (/^status$/i.test(text)) {
    return '状态记录';
  }
  if (/quarterly cadence;\s*simulated from composition rebalance_events/i.test(text)) {
    return '定期平衡；由组合再平衡事件模拟。';
  }
  const normalizedText = text.replace(/；/g, ';');
  const alignedMatch = normalizedText.match(
    /^Aligned\s+(\d+)\s+periods across\s+(\d+)\s+leg streams\.?;\s*(\d+)\s+missing leg periods used profile fallback streams\.?$/i,
  );
  if (alignedMatch) {
    return `已对齐 ${alignedMatch[1]} 个周期 / ${alignedMatch[2]} 条腿；${alignedMatch[3]} 个缺失腿周期使用画像 fallback 收益。`;
  }
  const alignedOnlyMatch = normalizedText.match(/^Aligned\s+(\d+)\s+periods across\s+(\d+)\s+leg streams\.?$/i);
  if (alignedOnlyMatch) {
    return `已对齐 ${alignedOnlyMatch[1]} 个周期 / ${alignedOnlyMatch[2]} 条腿。`;
  }
  return text;
}

function humanizeEvidenceTitle(value: unknown, fallback: string): string {
  const text = toText(value, fallback);
  const normalized = text.trim().toLowerCase();
  if (normalized === 'frozen config') {
    return '配置冻结';
  }
  if (normalized === 'data footprint') {
    return '数据足迹';
  }
  if (normalized === 'proxy logs') {
    return '代理日志';
  }
  if (normalized === 'algorithm spec') {
    return '算法规则';
  }
  if (normalized === 'audit trail') {
    return '审计轨迹';
  }
  return text;
}

function normalizeArray<T>(
  value: unknown,
  fallback: T[],
  normalize: (record: Record<string, unknown>, fallbackItem: T, index: number) => T,
): T[] {
  if (!Array.isArray(value)) {
    return fallback;
  }
  if (value.length === 0) {
    return [];
  }
  return value.map((item, index) => normalize(asRecord(item) ?? {}, fallback[Math.min(index, fallback.length - 1)], index));
}

function normalizePerformanceMetric(value: Record<string, unknown>, fallback: PerformanceMetric, index: number): PerformanceMetric {
  return {
    key: toText(getValue(value, ['key', 'id']), fallback.key || `metric-${index}`),
    label: toText(getValue(value, ['label', 'name', 'metric']), fallback.label),
    tenYear: toText(getValue(value, ['tenYear', 'ten_year', '10y', 'ten_year_value']), fallback.tenYear),
    twentyYear: toText(getValue(value, ['twentyYear', 'twenty_year', '20y', 'twenty_year_value']), fallback.twentyYear),
    thirtyYear: toText(getValue(value, ['thirtyYear', 'thirty_year', '30y', 'thirty_year_value']), fallback.thirtyYear),
    conclusion: humanizeRuntimeLabel(getValue(value, ['conclusion', 'verdict', 'note']), fallback.conclusion),
    proxyNote: humanizeRuntimeLabel(getValue(value, ['proxyNote', 'proxy_note', 'tooltip']), fallback.proxyNote ?? ''),
  };
}

function normalizeSleeveContribution(value: Record<string, unknown>, fallback: SleeveContribution, index: number): SleeveContribution {
  return {
    key: toText(getValue(value, ['key', 'id']), fallback.key || `sleeve-${index}`),
    name: toText(getValue(value, ['name', 'label', 'sleeve']), fallback.name),
    primary: toText(getValue(value, ['primary', 'tag', 'role']), fallback.primary),
    detail: toText(getValue(value, ['detail', 'body', 'summary']), fallback.detail),
    efficiency: toText(getValue(value, ['efficiency', 'efficiency_label', 'return_risk_efficiency']), fallback.efficiency),
    tone: toTone(getValue(value, ['tone', 'status']), fallback.tone),
    valuePct: toNumber(getValue(value, ['valuePct', 'value_pct', 'contribution_pct']), fallback.valuePct),
  };
}

function normalizeExposure(value: Record<string, unknown>, fallback: ExposureRow, index: number): ExposureRow {
  const note = toText(getValue(value, ['note', 'tooltip', 'evidence', 'detail']), fallback.note ?? '');
  const rawLabel = getValue(value, ['label', 'state', 'regime']);
  return {
    key: toText(getValue(value, ['key', 'id']), fallback.key || `exposure-${index}`),
    period: toText(getValue(value, ['period', 'label', 'year']), fallback.period),
    alphaPct: toNumber(getValue(value, ['alphaPct', 'alpha_pct', 'alpha']), fallback.alphaPct),
    qqqPct: toNumber(getValue(value, ['qqqPct', 'qqq_pct', 'qqq']), fallback.qqqPct),
    billPct: toNumber(getValue(value, ['billPct', 'bill_pct', 'tbill_pct', 't_bill']), fallback.billPct),
    cashPct: toNumber(getValue(value, ['cashPct', 'cash_pct', 'cash']), fallback.cashPct),
    label: rawLabel === undefined ? summarizeExposureLabel(note, fallback.label) : toText(rawLabel, fallback.label),
    note,
  };
}

function normalizeConcentration(value: Record<string, unknown>, fallback: ConcentrationHolding): ConcentrationHolding {
  return {
    symbol: toText(getValue(value, ['symbol', 'ticker']), fallback.symbol),
    detail: toText(getValue(value, ['detail', 'body', 'source']), fallback.detail),
    weightPct: toNumber(getValue(value, ['weightPct', 'weight_pct', 'weight']), fallback.weightPct),
    tone: toTone(getValue(value, ['tone', 'status']), fallback.tone),
  };
}

function normalizeJump(value: Record<string, unknown>, fallback: DiagnosisJump, index: number): DiagnosisJump {
  return {
    id: toText(getValue(value, ['id', 'key']), fallback.id || `jump-${index}`),
    title: toText(getValue(value, ['title', 'label']), fallback.title),
    body: toText(getValue(value, ['body', 'summary', 'detail']), fallback.body),
    eventId: toText(getValue(value, ['eventId', 'event_id']), fallback.eventId ?? ''),
    orderId: toText(getValue(value, ['orderId', 'order_id']), fallback.orderId ?? ''),
  };
}

function normalizeNetting(value: Record<string, unknown> | null, fallback?: NettingDetail): NettingDetail | undefined {
  if (!value && !fallback) {
    return undefined;
  }
  const source = value ?? {};
  return {
    title: toText(getValue(source, ['title', 'label']), fallback?.title ?? '内部对冲穿透'),
    rawSellDemand: toText(getValue(source, ['rawSellDemand', 'raw_sell_demand']), fallback?.rawSellDemand ?? '原始卖出需求待接入'),
    rawBuyDemand: toText(getValue(source, ['rawBuyDemand', 'raw_buy_demand']), fallback?.rawBuyDemand ?? '原始买入需求待接入'),
    internalMatch: toText(getValue(source, ['internalMatch', 'internal_match']), fallback?.internalMatch ?? '内部撮合数量待接入'),
    externalQuantity: toText(getValue(source, ['externalQuantity', 'external_quantity']), fallback?.externalQuantity ?? '最终外部成交待接入'),
    explanation: toText(getValue(source, ['explanation', 'body', 'summary']), fallback?.explanation ?? '内部撮合后只把剩余差额送入外部成交。'),
  };
}

function normalizeOrder(value: Record<string, unknown>, fallback: CompositionOrder, index: number): CompositionOrder {
  const sourceNetting = normalizeNetting(getRecord(value, ['netting', 'netting_detail']), fallback.netting);
  return {
    id: toText(getValue(value, ['id', 'trade_id', 'order_id']), fallback.id || `order-${index}`),
    time: toText(getValue(value, ['time', 'date', 'trade_date']), fallback.time),
    symbol: toText(getValue(value, ['symbol', 'ticker']), fallback.symbol),
    side: toText(getValue(value, ['side', 'direction', 'action']), fallback.side),
    quantity: toText(getValue(value, ['quantity', 'qty']), fallback.quantity),
    price: toText(getValue(value, ['price', 'fill_price']), fallback.price),
    slippageBps: toText(getValue(value, ['slippageBps', 'slippage_bps']), fallback.slippageBps),
    fee: toText(getValue(value, ['fee', 'fee_usd', 'commission']), fallback.fee),
    sleeve: toText(getValue(value, ['sleeve', 'sourceSleeve', 'source_sleeve', 'source_leg']), fallback.sleeve),
    triggerReason: humanizeRuntimeLabel(getValue(value, ['triggerReason', 'trigger_reason', 'reason']), fallback.triggerReason),
    nettingLabel: toText(getValue(value, ['nettingLabel', 'netting_label', 'netting']), fallback.nettingLabel),
    tone: toTone(getValue(value, ['tone', 'status']), fallback.tone),
    netting: sourceNetting,
  };
}

function normalizeEvent(value: Record<string, unknown>, fallback: RebalanceEvent, index: number): RebalanceEvent {
  const rawOrders = getValue(value, ['orders', 'lookthrough_orders', 'look_through_orders']);
  return {
    id: toText(getValue(value, ['id', 'event_id']), fallback.id || `event-${index}`),
    title: toText(getValue(value, ['title', 'label', 'date']), fallback.title),
    totalAmount: toText(getValue(value, ['totalAmount', 'total_amount', 'notional']), fallback.totalAmount),
    frictionCost: toText(getValue(value, ['frictionCost', 'friction_cost', 'cost']), fallback.frictionCost),
    triggerReason: humanizeRuntimeLabel(getValue(value, ['triggerReason', 'trigger_reason', 'reason']), fallback.triggerReason),
    effectiveness: toText(getValue(value, ['effectiveness', 'effect', 'contribution']), fallback.effectiveness),
    orders: normalizeArray(rawOrders, fallback.orders, normalizeOrder),
  };
}

function normalizeEfficiency(value: Record<string, unknown>, fallback: EfficiencyRow, index: number): EfficiencyRow {
  return {
    id: toText(getValue(value, ['id', 'key']), fallback.id || `efficiency-${index}`),
    event: toText(getValue(value, ['event', 'label']), fallback.event),
    trigger: humanizeRuntimeLabel(getValue(value, ['trigger', 'trigger_reason']), fallback.trigger),
    contribution: toText(getValue(value, ['contribution', 'effectiveness']), fallback.contribution),
    slippage: toText(getValue(value, ['slippage', 'slippage_bps']), fallback.slippage),
    fee: toText(getValue(value, ['fee', 'fee_bps', 'commission']), fallback.fee),
    detailLabel: toText(getValue(value, ['detailLabel', 'detail_label', 'action']), fallback.detailLabel),
  };
}

function normalizeEvidenceCard(value: Record<string, unknown>, fallback: EvidenceCard, index: number): EvidenceCard {
  return {
    id: toText(getValue(value, ['id', 'key']), fallback.id || `evidence-${index}`),
    title: humanizeEvidenceTitle(getValue(value, ['title', 'label']), fallback.title),
    body: toText(getValue(value, ['body', 'summary', 'detail']), fallback.body),
    tone: toTone(getValue(value, ['tone', 'status']), fallback.tone),
  };
}

function normalizeProxyLog(value: Record<string, unknown>, fallback: ProxyLog, index: number): ProxyLog {
  return {
    id: toText(getValue(value, ['id', 'key']), fallback.id || `proxy-${index}`),
    period: toText(getValue(value, ['period', 'window']), fallback.period),
    missingSleeve: humanizeRuntimeLabel(getValue(value, ['missingSleeve', 'missing_sleeve', 'source']), fallback.missingSleeve),
    proxy: humanizeRuntimeLabel(getValue(value, ['proxy', 'proxy_source', 'confidence']), fallback.proxy),
    correlation: toText(getValue(value, ['correlation', 'corr']), fallback.correlation),
    usage: humanizeRuntimeLabel(getValue(value, ['usage', 'purpose']), fallback.usage),
  };
}

function normalizeAuditEntry(value: Record<string, unknown>, fallback: AuditEntry, index: number): AuditEntry {
  return {
    id: toText(getValue(value, ['id', 'key']), fallback.id || `audit-${index}`),
    title: humanizeRuntimeLabel(getValue(value, ['title', 'action', 'label']), fallback.title),
    body: humanizeRuntimeLabel(getValue(value, ['body', 'summary', 'detail']), fallback.body),
    at: toText(getValue(value, ['at', 'time', 'created_at']), fallback.at ?? ''),
  };
}

function normalizeStressZoom(value: Record<string, unknown> | null, fallback: StressZoom): StressZoom {
  return {
    label: toText(getValue(value, ['label', 'title']), fallback.label),
    portfolioDrawdown: toText(getValue(value, ['portfolioDrawdown', 'portfolio_drawdown']), fallback.portfolioDrawdown),
    benchmarkLabel: toText(getValue(value, ['benchmarkLabel', 'benchmark_label']), fallback.benchmarkLabel),
    benchmarkDrawdown: toText(getValue(value, ['benchmarkDrawdown', 'benchmark_drawdown']), fallback.benchmarkDrawdown),
    timeToRecovery: toText(getValue(value, ['timeToRecovery', 'time_to_recovery', 'recovery']), fallback.timeToRecovery),
    note: toText(getValue(value, ['note', 'body', 'summary']), fallback.note),
  };
}

export function normalizeCompositionBacktestResult(
  data: unknown,
  ids: { compositionId: string; runId: string },
): CompositionBacktestResult {
  const root = asRecord(data);
  const diagnosis = getRecord(root, ['diagnosis', 'diagnostics']);
  const orders = getRecord(root, ['orders', 'order_book']);
  const evidence = getRecord(root, ['evidence', 'proof']);
  const fallback = DEFAULT_RESULT;
  const events = normalizeArray(getValue(orders, ['events', 'rebalance_events']), fallback.events, normalizeEvent);
  const exposureRows = normalizeArray(
    getValue(diagnosis, ['exposureRows', 'exposure_rows', 'exposure_heatmap']),
    fallback.exposureRows,
    normalizeExposure,
  );
  const rawConcentration = getValue(diagnosis, ['concentrationTop5', 'concentration_top5', 'top_holdings']);
  const concentrationTop5 = Array.isArray(rawConcentration)
    ? rawConcentration.map((item, index) =>
      normalizeConcentration(asRecord(item) ?? {}, fallback.concentrationTop5[Math.min(index, fallback.concentrationTop5.length - 1)]),
    )
    : normalizeArray(rawConcentration, fallback.concentrationTop5, normalizeConcentration);
  const ledgerFallback = fallback.ledgerRows.length
    ? fallback.ledgerRows
    : events.flatMap((event) => event.orders);

  return {
    compositionId: ids.compositionId,
    runId: ids.runId,
    title: toText(getValue(root, ['title', 'name']), fallback.title),
    subtitle: toText(getValue(root, ['subtitle', 'summary', 'description']), fallback.subtitle),
    statusChips: normalizeArray(getValue(root, ['statusChips', 'status_chips']), fallback.statusChips, (value, item) =>
      toText(getValue(value, ['label', 'value', 'text']), item),
    ),
    stabilityRuling: humanizeRuntimeLabel(getValue(diagnosis, ['stabilityRuling', 'stability_ruling', 'verdict']), fallback.stabilityRuling),
    stabilityDetail: humanizeRuntimeLabel(getValue(diagnosis, ['stabilityDetail', 'stability_detail', 'detail']), fallback.stabilityDetail),
    proxyCoverageNote: humanizeRuntimeLabel(getValue(diagnosis, ['proxyCoverageNote', 'proxy_coverage_note']), fallback.proxyCoverageNote),
    exposureAuditNote: buildExposureAuditNote(exposureRows),
    performanceMatrix: normalizeArray(
      getValue(diagnosis, ['performanceMatrix', 'performance_matrix', 'metrics']),
      fallback.performanceMatrix,
      normalizePerformanceMetric,
    ),
    sleeveContributions: normalizeArray(
      getValue(diagnosis, ['sleeveContributions', 'sleeve_contributions', 'attribution']),
      fallback.sleeveContributions,
      normalizeSleeveContribution,
    ),
    exposureRows,
    stressZoom: normalizeStressZoom(getRecord(diagnosis, ['stressZoom', 'stress_zoom']), fallback.stressZoom),
    concentrationTop5,
    diagnosisJumps: normalizeArray(
      getValue(diagnosis, ['diagnosisJumps', 'diagnosis_jumps', 'insights']),
      fallback.diagnosisJumps,
      normalizeJump,
    ),
    events,
    ledgerRows: normalizeArray(getValue(orders, ['ledgerRows', 'ledger_rows', 'full_ledger']), ledgerFallback, normalizeOrder),
    efficiencyRows: normalizeArray(
      getValue(orders, ['efficiencyRows', 'efficiency_rows', 'rebalance_efficiency']),
      fallback.efficiencyRows,
      normalizeEfficiency,
    ),
    evidenceCards: normalizeArray(
      getValue(evidence, ['cards', 'evidenceCards', 'evidence_cards']),
      fallback.evidenceCards,
      normalizeEvidenceCard,
    ),
    proxyLogs: normalizeArray(getValue(evidence, ['proxyLogs', 'proxy_logs']), fallback.proxyLogs, normalizeProxyLog),
    auditTrail: normalizeArray(getValue(evidence, ['auditTrail', 'audit_trail']), fallback.auditTrail, normalizeAuditEntry),
  };
}

function getToneClassName(prefix: string, tone: Tone): string {
  return `${prefix} ${prefix}--${tone}`;
}

function getMetricText(metric: PerformanceMetric): string {
  return `${metric.label} ${metric.tenYear} ${metric.twentyYear} ${metric.thirtyYear} ${metric.conclusion}`;
}

function findPerformanceMetric(
  result: CompositionBacktestResult,
  predicate: (metric: PerformanceMetric) => boolean,
): PerformanceMetric | undefined {
  return result.performanceMatrix.find(predicate);
}

function extractFirstPercent(value: string): string {
  const match = value.match(/[-+]?\d+(?:\.\d+)?%/);
  return match?.[0] ?? value.split('/')[0]?.trim() ?? '暂无';
}

function extractSharpeValue(value: string): string {
  const sharpeMatch = value.match(/(?:Sharpe|夏普)\s*([-+]?\d+(?:\.\d+)?)/i);
  if (sharpeMatch?.[1]) {
    return sharpeMatch[1];
  }
  const firstNumber = value.match(/[-+]?\d+(?:\.\d+)?/);
  return firstNumber?.[0] ?? '暂无';
}

function deriveHeroMetrics(result: CompositionBacktestResult): HeroMetric[] {
  const annualizedMetric =
    findPerformanceMetric(result, (metric) => /年化/.test(metric.label)) ??
    findPerformanceMetric(result, (metric) => /收益质量|Sharpe|夏普/i.test(getMetricText(metric)));
  const sharpeMetric =
    findPerformanceMetric(result, (metric) => /Sharpe|夏普/i.test(getMetricText(metric))) ??
    annualizedMetric;
  const drawdownMetric =
    findPerformanceMetric(result, (metric) => /MDD|回撤|尾部风险/i.test(getMetricText(metric))) ??
    findPerformanceMetric(result, (metric) => /风险/.test(metric.label));
  const coverageMetric =
    findPerformanceMetric(result, (metric) => /覆盖|代理|不足|长历史/i.test(getMetricText(metric)));

  const annualizedValue = extractFirstPercent(annualizedMetric?.tenYear ?? '暂无');
  const sharpeValue = extractSharpeValue(sharpeMetric?.tenYear ?? annualizedMetric?.tenYear ?? '暂无');
  const drawdownValue = extractFirstPercent(drawdownMetric?.tenYear ?? '暂无').replace(/^MDD\s*/i, '');
  const coverageText = coverageMetric?.thirtyYear ?? result.proxyCoverageNote;
  const coverageValue = /覆盖\s*[-+]?\d/.test(coverageText)
    ? coverageText.replace(/^覆盖\s*/, '')
    : /不足|需|代理|fallback/i.test(coverageText)
      ? '需复核'
      : '已记录';

  return [
    {
      key: 'annualized',
      label: '年化收益',
      value: annualizedValue,
      detail: annualizedMetric?.conclusion ?? result.stabilityRuling,
      tone: 'good',
    },
    {
      key: 'sharpe',
      label: '夏普比率',
      value: sharpeValue,
      detail: sharpeMetric?.conclusion ?? '收益质量待复核',
      tone: sharpeValue === '暂无' ? 'neutral' : 'good',
    },
    {
      key: 'drawdown',
      label: '最大回撤',
      value: drawdownValue,
      detail: drawdownMetric?.conclusion ?? '压力窗口下钻',
      tone: /暂无|不足/.test(drawdownValue) ? 'warning' : 'danger',
    },
    {
      key: 'coverage',
      label: '样本覆盖',
      value: coverageValue,
      detail: coverageValue === '需复核' ? '代理覆盖见指标矩阵与证据页。' : '覆盖状态已记录。',
      tone: coverageValue === '需复核' ? 'warning' : 'info',
    },
    deriveDataConfidence(result),
  ];
}

function isWeakMetricValue(value: string): boolean {
  return /不足|暂无|需|代理|fallback/i.test(value);
}

function buildExposureAuditNote(rows: ExposureRow[]): string {
  const notes = Array.from(
    new Set(rows.map((row) => humanizeRuntimeLabel(row.note, '')).filter((note) => note.trim())),
  );
  return notes.length
    ? notes.join('；')
    : '敞口热力图按组合再平衡事件生成；保存组合保留冻结来源证据，模拟不会改写组合腿。';
}

function buildPerformanceComparisons(metrics: PerformanceMetric[]): PerformanceComparison[] {
  const horizons: Array<{ key: keyof Pick<PerformanceMetric, 'tenYear' | 'twentyYear' | 'thirtyYear'>; label: string }> = [
    { key: 'tenYear', label: '10Y' },
    { key: 'twentyYear', label: '20Y' },
    { key: 'thirtyYear', label: '30Y' },
  ];
  return horizons.map((horizon) => {
    const rows = metrics.map((metric) => {
      const value = metric[horizon.key];
      return {
        key: metric.key,
        label: metric.label,
        value,
        conclusion: metric.conclusion,
        proxyNote: metric.proxyNote,
        weak: isWeakMetricValue(value),
      };
    });
    const weakCount = rows.filter((row) => row.weak).length;
    const allWeak = rows.length > 0 && weakCount === rows.length;
    return {
      key: String(horizon.key),
      label: horizon.label,
      status: allWeak ? '数据不足' : weakCount > 0 ? '需复核' : '可用',
      tone: allWeak ? 'warning' : weakCount > 0 ? 'info' : 'good',
      rows,
    };
  });
}

function extractPercentNumber(value: string): number | null {
  const match = value.match(/([-+]?\d+(?:\.\d+)?)%/);
  if (!match?.[1]) {
    return null;
  }
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function deriveDataConfidence(result: CompositionBacktestResult): HeroMetric {
  const coverageMetric = findPerformanceMetric(result, (metric) => /覆盖|代理|不足|长历史/i.test(getMetricText(metric)));
  const coverageFromMetric =
    extractPercentNumber(coverageMetric?.thirtyYear ?? '') ??
    extractPercentNumber(result.proxyCoverageNote);
  const fallbackPenalty = /代理|fallback|需复核|缺失/i.test(result.proxyCoverageNote) ? 18 : 0;
  const score = coverageFromMetric === null
    ? (/需复核|不足|代理|fallback/i.test(result.proxyCoverageNote) ? 62 : 86)
    : Math.max(0, Math.min(100, Math.round(coverageFromMetric - fallbackPenalty)));
  return {
    key: 'data_confidence',
    label: '数据置信度',
    value: `${score}`,
    detail: score >= 80 ? '可作为主裁决样本。' : score >= 55 ? '代理占比偏高，建议复核证据页。' : '代理或缺失较多，仅作方向判断。',
    tone: score >= 80 ? 'good' : score >= 55 ? 'warning' : 'danger',
  };
}

function deriveHeroFingerprint(result: CompositionBacktestResult): string {
  const sharpeMetric =
    findPerformanceMetric(result, (metric) => /Sharpe|夏普/i.test(getMetricText(metric))) ??
    findPerformanceMetric(result, (metric) => /收益质量/i.test(metric.label));
  const sharpe = extractSharpeValue(sharpeMetric?.tenYear ?? result.subtitle);
  return `10Y 夏普 ${sharpe}`;
}

function formatSleeveEfficiency(returnPct: unknown, riskPct: unknown): string {
  const returnValue = typeof returnPct === 'number' ? returnPct : Number(returnPct);
  const riskValue = typeof riskPct === 'number' ? riskPct : Number(riskPct);
  if (!Number.isFinite(returnValue) || !Number.isFinite(riskValue)) {
    return '待评估';
  }
  if (Math.abs(riskValue) < 0.01) {
    return returnValue > 0 ? '防守' : '低风险';
  }
  return `${(returnValue / riskValue).toFixed(2)}x`;
}

function uniqueSymbols(rows: CompositionOrder[]): string[] {
  const values = rows.map((row) => row.symbol).filter(Boolean);
  return Array.from(new Set(values));
}

function uniqueSourceLegs(rows: CompositionOrder[]): string[] {
  const values = rows.map((row) => row.sleeve).filter(Boolean);
  return Array.from(new Set(values));
}

function getInitialTab(tab?: ResultTab): ResultTab {
  return tab === 'orders' || tab === 'evidence' || tab === 'diagnosis' ? tab : 'diagnosis';
}

function getInitialOrderMode(mode?: OrderMode): OrderMode {
  return mode === 'ledger' ? 'ledger' : 'events';
}

function formatMetric(value: unknown, suffix = ''): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return '暂无';
  }
  return `${numeric.toFixed(Math.abs(numeric) >= 10 ? 1 : 2)}${suffix}`;
}

function summarizeExposureLabel(note: unknown, fallback: string): string {
  const text = toText(note, '');
  if (!text) {
    return fallback;
  }
  if (/drawdown|回撤|stress/i.test(text)) {
    return '回撤触发';
  }
  if (/threshold|drift|偏离|阈/i.test(text)) {
    return '偏离触发';
  }
  if (/simulated/i.test(text) && /quarterly|cadence|aligned leg return streams/i.test(text)) {
    return '定期平衡';
  }
  if (/simulated/i.test(text)) {
    return '模拟调仓';
  }
  return text.length > 18 ? `${text.slice(0, 18)}...` : text;
}

function formatOrderQuantity(value: unknown): string {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return '待计算';
  }
  return `${numeric.toFixed(Math.abs(numeric) >= 10 ? 1 : 2)}%`;
}

function apiOrderToView(order: ApiCompositionBacktestOrder): Record<string, unknown> {
  const nettingRatio = Number(order.netting_ratio_pct || 0);
  return {
    id: order.id,
    order_id: order.order_id,
    time: order.event_date ?? order.event_label,
    symbol: order.symbol,
    side: order.side === 'BUY' ? '买入' : '卖出',
    quantity: formatOrderQuantity(order.quantity),
    price: order.price === null || order.price === undefined ? '模型指令' : formatMetric(order.price),
    slippage_bps: `${formatMetric(order.slippage_bps)} bps`,
    fee: order.fee_amount === null || order.fee_amount === undefined ? '未形成外部成交' : `$${formatMetric(order.fee_amount)}`,
    source_sleeve: order.source_leg_name,
    trigger_reason: humanizeRuntimeLabel(order.trigger_reason, order.trigger_reason),
    netting_label: nettingRatio > 0 ? `内部对冲 ${nettingRatio.toFixed(0)}%` : '外部成交',
    tone: order.side === 'BUY' ? 'good' : 'warning',
    netting_detail: {
      title: `${order.symbol} 内部对冲`,
      raw_sell_demand: `${formatOrderQuantity(order.gross_sell_quantity)} 卖出需求`,
      raw_buy_demand: `${formatOrderQuantity(order.gross_buy_quantity)} 买入需求`,
      internal_match: `${formatOrderQuantity(order.internal_net_quantity)} 内部撮合`,
      external_quantity: `${formatOrderQuantity(order.external_quantity)} 外部成交`,
      explanation: order.evidence_label,
    },
  };
}

function buildApiBacktestViewData(
  run: ApiCompositionBacktestRun,
  orders: ApiCompositionBacktestOrder[],
): Record<string, unknown> {
  const metric = (run.diagnostics?.metric_matrix as Array<Record<string, unknown>> | undefined)?.[0] ?? {};
  const topHoldings = Array.isArray(run.diagnostics?.top_holdings)
    ? (run.diagnostics.top_holdings as Array<Record<string, unknown>>)
    : [];
  const algorithmSpec = asRecord(run.evidence?.algorithm_spec) ?? {};
  const orderRows = orders.map(apiOrderToView);
  const ordersByEvent = new Map<string, Record<string, unknown>[]>();
  orderRows.forEach((order) => {
    const eventId = String(order.event_id ?? (order as { event_id?: string }).event_id ?? '');
    const rawOrder = orders.find((item) => item.id === order.id);
    const key = rawOrder?.event_id || eventId || 'event-001';
    const rows = ordersByEvent.get(key) ?? [];
    rows.push(order);
    ordersByEvent.set(key, rows);
  });

  return {
    title: `${String(run.summary?.composition_name ?? '组合')} · 回测诊断`,
    subtitle: `${String(run.summary?.horizon_years ?? '10')}Y / 年化 ${formatMetric(run.summary?.annualized_return, '%')} / 夏普 ${formatMetric(run.summary?.sharpe)}`,
    status_chips: [
      humanizeRuntimeLabel(run.status, run.status),
      humanizeRuntimeLabel(run.summary?.quality_label, '组合详情预演'),
      `订单 ${String(run.summary?.order_count ?? orders.length)}`,
    ],
    diagnostics: {
      stability_ruling: String(run.diagnostics?.stability_verdict ?? '稳定性待复核'),
      stability_detail: String(run.summary?.evidence_label ?? '本次结果来自组合详情收益流、再平衡事件和来源冻结证据。'),
      proxy_coverage_note: (run.return_quality_summary?.notes ?? []).join('；') || '代理覆盖已在证据页列出。',
      performance_matrix: [
        {
          label: '收益质量',
          tenYear: `${formatMetric(metric.annualized_return ?? run.summary?.annualized_return, '%')} / 夏普 ${formatMetric(metric.sharpe ?? run.summary?.sharpe)}`,
          twentyYear: run.return_quality_summary?.fallback_used ? '代理覆盖需复核' : '覆盖良好',
          thirtyYear: run.return_quality_summary?.coverage_pct ? `覆盖 ${formatMetric(run.return_quality_summary.coverage_pct, '%')}` : '数据不足',
          conclusion: String(run.diagnostics?.stability_verdict ?? '待复核'),
          proxy_note: (run.return_quality_summary?.notes ?? [])[0],
        },
        {
          label: '尾部风险',
          tenYear: `最大回撤 ${formatMetric(metric.max_drawdown ?? run.summary?.max_drawdown, '%')}`,
          twentyYear: '压力窗口下钻',
          thirtyYear: '需真实长历史',
          conclusion: '用压力窗口和订单事件复核',
        },
      ],
      sleeve_contributions: run.risk_contribution_preview.map((item) => ({
        key: item.leg_id,
        name: item.label,
        primary: `收益贡献 ${formatMetric(item.return_contribution_pct, '%')}`,
        detail: `风险贡献 ${formatMetric(item.contribution_pct, '%')} / 权重 ${formatMetric(item.weight_pct, '%')}`,
        efficiency: formatSleeveEfficiency(item.return_contribution_pct, item.contribution_pct),
        tone: Number(item.contribution_pct) > Number(item.weight_pct) * 1.4 ? 'warning' : 'good',
        valuePct: item.contribution_pct,
      })),
      exposure_heatmap: run.rebalance_events.slice(0, 4).map((event, index) => ({
        key: `exposure-${index}`,
        period: event.label,
        alphaPct: Number(Object.values(event.weight_after ?? {})[0] ?? 0),
        qqqPct: Number(Object.values(event.weight_after ?? {})[1] ?? 0),
        billPct: Number(Object.values(event.weight_after ?? {})[2] ?? 0),
        cashPct: Number(Object.values(event.weight_after ?? {})[3] ?? 0),
        label: summarizeExposureLabel(event.notes?.[0], '定期平衡'),
        note: event.notes?.[0] ?? '',
      })),
      top_holdings: topHoldings,
      insights: [
        {
          id: 'orders-jump',
          title: '再平衡订单可复核',
          body: '查看订单 Tab 可穿透内部对冲和全量流水。',
          event_id: orders[0]?.event_id,
          order_id: orders[0]?.id,
        },
      ],
    },
    orders: {
      events: run.rebalance_events.map((event, index) => {
        const eventId = `event_${Number(event.index || index + 1).toString().padStart(3, '0')}`;
        return {
          id: eventId,
          label: event.label,
          total_amount: `${formatMetric(event.turnover_pct, '%')} 换手`,
          friction_cost: `${formatMetric(event.estimated_cost_bps)} bps`,
          trigger_reason: humanizeRuntimeLabel(event.notes?.[0], '定期平衡'),
          effectiveness: `成本拖累 ${formatMetric(event.cost_drag_pct, '%')}`,
          orders: ordersByEvent.get(eventId) ?? [],
        };
      }),
      full_ledger: orderRows,
      rebalance_efficiency: run.rebalance_events.map((event, index) => ({
        id: `eff-${index}`,
        event: event.label,
        trigger: humanizeRuntimeLabel(event.notes?.[0], '定期平衡'),
        contribution: `现金缓冲 ${formatMetric(event.cash_buffer_pct, '%')}`,
        slippage_bps: `${formatMetric(event.estimated_cost_bps)} bps`,
        fee: '见全量流水',
        action: '查看订单明细',
      })),
    },
    evidence: {
      cards: [
        {
          id: 'frozen-config',
          label: '配置冻结',
          body: `组合 ${run.composition_id} / 运行 ${run.run_id}`,
          tone: 'good',
        },
        {
          id: 'data-footprint',
          label: '数据足迹',
          body: `${run.returns_preview.length} 个收益点，${run.benchmark_series.length} 个基准点`,
          tone: 'info',
        },
        {
          id: 'algorithm-spec',
          label: '算法规则',
          body: `调仓频率：${humanizeRuntimeLabel(algorithmSpec.rebalance_frequency, '已锁定')}；订单口径：${humanizeRuntimeLabel(algorithmSpec.orders, '已记录')}`,
          tone: 'neutral',
        },
      ],
      proxy_logs: (run.return_quality_summary?.notes ?? []).map((note, index) => ({
        id: `proxy-${index}`,
        period: '代理覆盖',
        source: note,
        confidence: run.return_quality_summary?.fallback_used ? '需复核' : '已记录',
      })),
      audit_trail: run.audit_trail.map((item) => ({
        id: item.id,
        time: item.at,
        action: item.action,
        detail: item.summary,
      })),
    },
  };
}

function buildEmptyRuntimeBacktestViewData(ids: { compositionId: string; runId: string }): Record<string, unknown> {
  return {
    title: '组合回测结果',
    subtitle: `${ids.compositionId} / ${ids.runId}`,
    status_chips: ['加载中'],
    diagnostics: {
      stability_ruling: '等待运行时数据',
      stability_detail: '页面正在读取本地 API；未使用示例订单或静态数据。',
      proxy_coverage_note: '',
      performance_matrix: [],
      sleeve_contributions: [],
      exposure_heatmap: [],
      top_holdings: [],
      insights: [],
    },
    orders: {
      events: [],
      full_ledger: [],
      rebalance_efficiency: [],
    },
    evidence: {
      cards: [],
      proxy_logs: [],
      audit_trail: [],
    },
  };
}

export function CompositionBacktestResultPage({
  compositionId,
  runId,
  data,
  highlightedEventId,
  highlightedOrderId,
  initialOrderMode,
  initialTab,
  onExportLedger,
  onRerunBacktest,
  onStartOptimization,
}: CompositionBacktestResultPageProps): JSX.Element {
  let api: ReturnType<typeof useApiClient> | null = null;
  try {
    api = useApiClient();
  } catch {
    api = null;
  }
  const [remoteData, setRemoteData] = useState<unknown | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!data);

  useEffect(() => {
    let cancelled = false;
    if (data || !api?.getCompositionBacktestRun) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const apiClient = api;

    async function load(): Promise<void> {
      try {
        setLoading(true);
        setLoadError(null);
        const run = await apiClient.getCompositionBacktestRun!(compositionId, runId);
        const orderPage = apiClient.getCompositionBacktestOrders
          ? await apiClient.getCompositionBacktestOrders(compositionId, runId, { page: 1, page_size: 500 })
          : { items: [] };
        if (!cancelled) {
          setRemoteData(buildApiBacktestViewData(run, orderPage.items));
        }
      } catch (caught) {
        if (!cancelled) {
          setLoadError(`加载组合回测结果失败：${(caught as Error).message}`);
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
  }, [api, compositionId, data, runId]);

  const result = useMemo(
    () => normalizeCompositionBacktestResult(
      data ?? remoteData ?? (api?.getCompositionBacktestRun ? buildEmptyRuntimeBacktestViewData({ compositionId, runId }) : undefined),
      { compositionId, runId },
    ),
    [api, compositionId, data, remoteData, runId],
  );
  const heroMetrics = useMemo(() => deriveHeroMetrics(result), [result]);
  const performanceComparisons = useMemo(() => buildPerformanceComparisons(result.performanceMatrix), [result.performanceMatrix]);
  const heroFingerprint = useMemo(() => deriveHeroFingerprint(result), [result]);
  const stressOrderJump = useMemo<DiagnosisJump>(() => {
    const stressEvent = result.events.find((event) => /2020|压力|回撤/i.test(`${event.id} ${event.title} ${event.triggerReason}`)) ?? result.events[0];
    return {
      id: 'stress-2020-orders',
      title: '2020 压力窗口订单',
      body: '点击净值图压力点后定位到对应订单明细。',
      eventId: stressEvent?.id,
      orderId: stressEvent?.orders[0]?.id,
    };
  }, [result.events]);
  const concentrationAlert = useMemo(() => {
    const highlighted = result.concentrationTop5.reduce<ConcentrationHolding | undefined>(
      (best, holding) => (!best || holding.weightPct > best.weightPct ? holding : best),
      undefined,
    );
    return highlighted ? `${highlighted.symbol} ${highlighted.weightPct.toFixed(1)}%` : '集中度复核';
  }, [result.concentrationTop5]);
  const sourceLegs = useMemo(() => uniqueSourceLegs(result.ledgerRows), [result.ledgerRows]);
  const [activeTab, setActiveTab] = useState<ResultTab>(getInitialTab(initialTab));
  const [orderMode, setOrderMode] = useState<OrderMode>(getInitialOrderMode(initialOrderMode));
  const [selectedEventId, setSelectedEventId] = useState(highlightedEventId ?? result.events[0]?.id ?? '');
  const [selectedOrderId, setSelectedOrderId] = useState(highlightedOrderId ?? '');
  const [sourceLegFilter, setSourceLegFilter] = useState('全部');
  const [symbolFilter, setSymbolFilter] = useState('全部');
  const [selectedNetting, setSelectedNetting] = useState<NettingDetail | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const selectedEvent = result.events.find((event) => event.id === selectedEventId) ?? result.events[0];
  const sourceFilteredLedgerRows = useMemo(
    () => sourceLegFilter === '全部'
      ? result.ledgerRows
      : result.ledgerRows.filter((row) => row.sleeve === sourceLegFilter),
    [result.ledgerRows, sourceLegFilter],
  );
  const symbols = useMemo(() => uniqueSymbols(sourceFilteredLedgerRows), [sourceFilteredLedgerRows]);
  const visibleLedgerRows = useMemo(
    () => symbolFilter === '全部'
      ? sourceFilteredLedgerRows
      : sourceFilteredLedgerRows.filter((row) => row.symbol === symbolFilter),
    [sourceFilteredLedgerRows, symbolFilter],
  );
  const selectedOrder = selectedEvent?.orders.find((order) => order.id === selectedOrderId);

  useEffect(() => {
    if (sourceLegFilter !== '全部' && !sourceLegs.includes(sourceLegFilter)) {
      setSourceLegFilter('全部');
      setSymbolFilter('全部');
    }
  }, [sourceLegFilter, sourceLegs]);

  useEffect(() => {
    if (symbolFilter !== '全部' && !symbols.includes(symbolFilter)) {
      setSymbolFilter('全部');
    }
  }, [symbolFilter, symbols]);

  function jumpToOrders(jump: DiagnosisJump): void {
    setActiveTab('orders');
    setOrderMode('events');
    setSelectedEventId(jump.eventId || result.events[0]?.id || '');
    setSelectedOrderId(jump.orderId || '');
  }

  async function exportLedger(format: ExportFormat): Promise<void> {
    setExportMenuOpen(false);
    if (onExportLedger) {
      onExportLedger(format, result);
      return;
    }
    if (!api?.exportCompositionBacktestOrders) {
      setExportStatus('导出接口尚未接入。');
      return;
    }
    try {
      const exportFormat = format === 'excel' ? 'xlsx' : 'csv';
      const content = await api.exportCompositionBacktestOrders(result.compositionId, result.runId, exportFormat, {
        symbol: symbolFilter === '全部' ? null : symbolFilter,
        source_leg: sourceLegFilter === '全部' ? null : sourceLegFilter,
      });
      const blob = new Blob([content], {
        type: exportFormat === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${result.compositionId}-${result.runId}-orders.${exportFormat}`;
      link.click();
      URL.revokeObjectURL(url);
      setExportStatus(`已导出 ${exportFormat.toUpperCase()} 明细。`);
    } catch (caught) {
      setExportStatus(`导出失败：${(caught as Error).message}`);
    }
  }

  return (
    <div
      className="composition-backtest-result-page stack"
      data-page-root="composition-backtest-result"
      data-route-root="compositions"
    >
      <section className="panel composition-backtest-result-hero">
        <div className="composition-backtest-result-hero__copy">
          <p className="page-heading__eyebrow">组合回测</p>
          <div className="composition-backtest-result-hero__title-row">
            <h1>{result.title}</h1>
            <span className="composition-backtest-fingerprint">{heroFingerprint}</span>
          </div>
          <div className="composition-backtest-chip-row" aria-label="回测状态">
            {result.statusChips.map((chip) => (
              <span className="status-chip status-chip--soft" key={chip}>{chip}</span>
            ))}
            <span className="composition-backtest-muted-run-id">运行 {result.runId}</span>
          </div>
        </div>
        <div className="composition-backtest-result-hero__actions">
          <button className="ghost-button" onClick={() => onRerunBacktest?.(result.compositionId, result.runId)} type="button">
            重跑回测
          </button>
          <button className="primary-button" onClick={() => onStartOptimization?.(result.compositionId, result.runId)} type="button">
            启动优化
          </button>
        </div>
      </section>
      {loading ? <div className="composition-backtest-runtime-note">正在加载组合回测结果。</div> : null}
      {loadError ? <div className="composition-backtest-runtime-note composition-backtest-runtime-note--warning">{loadError}</div> : null}

      <section className="panel composition-backtest-result-tabs-panel">
        <div className="composition-backtest-result-tabs" role="tablist" aria-label="组合回测结果">
          {([
            ['diagnosis', '诊断', '结果是否稳定'],
            ['orders', '订单', '执行是否合理'],
            ['evidence', '证据', '来源是否可信'],
          ] as Array<[ResultTab, string, string]>).map(([tab, label, summary]) => (
            <button
              aria-selected={activeTab === tab}
              className={activeTab === tab ? 'composition-backtest-result-tab is-active' : 'composition-backtest-result-tab'}
              key={tab}
              onClick={() => setActiveTab(tab)}
              role="tab"
              type="button"
            >
              <strong>{label}</strong>
              <span>{summary}</span>
            </button>
          ))}
        </div>
      </section>

      {activeTab === 'diagnosis' ? (
        <div className="composition-backtest-result-tab-panel" role="tabpanel" aria-label="诊断">
          <section className="composition-backtest-diagnosis-grid">
            <article className="panel composition-backtest-result-panel composition-backtest-result-panel--main">
              <div className="composition-backtest-verdict">
                <strong>{result.stabilityRuling}</strong>
                <span>{result.stabilityDetail}</span>
              </div>
              <div className="composition-backtest-chart-card" aria-label="组合净值诊断图">
                <svg viewBox="0 0 980 258" role="img" aria-label="组合净值、基准、成本拖累和压力阶段">
                  <line className="composition-backtest-grid-line" x1="42" x2="940" y1="54" y2="54" />
                  <line className="composition-backtest-grid-line" x1="42" x2="940" y1="104" y2="104" />
                  <line className="composition-backtest-grid-line" x1="42" x2="940" y1="154" y2="154" />
                  <line className="composition-backtest-grid-line" x1="42" x2="940" y1="204" y2="204" />
                  <rect className="composition-backtest-stress-band" x="270" y="42" width="122" height="184" rx="14" />
                  <rect className="composition-backtest-stress-band composition-backtest-stress-band--rate" x="682" y="42" width="128" height="184" rx="14" />
                  <path className="composition-backtest-drawdown-area" d="M42 190 C170 168 260 214 366 178 C500 134 610 198 730 160 C830 138 900 166 940 150 L940 228 L42 228 Z" />
                  <path className="composition-backtest-benchmark-line" d="M58 172 C190 128 315 112 446 104 C600 94 746 98 918 118" />
                  <path className="composition-backtest-cost-line" d="M58 188 C188 146 320 134 448 126 C604 116 750 122 918 144" />
                  <path className="composition-backtest-portfolio-line" d="M58 184 C172 138 294 112 424 99 C560 82 704 82 824 95 C880 101 916 112 940 126" />
                  <circle className="composition-backtest-chart-node" cx="352" cy="110" r="8" />
                  <circle className="composition-backtest-chart-node" cx="742" cy="96" r="8" />
                  <text className="composition-backtest-chart-label" x="52" y="32">净收益 +11.8%</text>
                  <text className="composition-backtest-stress-label" x="294" y="70">2020 疫情</text>
                  <text className="composition-backtest-stress-label" x="704" y="70">2022 加息</text>
                </svg>
                <button
                  aria-label="查看 2020 压力窗口订单明细"
                  className="composition-backtest-chart-callout composition-backtest-chart-callout--stress"
                  onClick={() => jumpToOrders(stressOrderJump)}
                  type="button"
                >
                  2020 订单
                </button>
              </div>
              <div className="composition-backtest-chart-legend">
                <span className="composition-backtest-legend-item composition-backtest-legend-item--portfolio">组合净值</span>
                <span className="composition-backtest-legend-item composition-backtest-legend-item--benchmark">基准</span>
                <span className="composition-backtest-legend-item composition-backtest-legend-item--cost">成本后</span>
                <span className="composition-backtest-legend-item composition-backtest-legend-item--drawdown">回撤带</span>
              </div>
              <article className="composition-backtest-stress-card">
                <div>
                  <strong>{result.stressZoom.label}</strong>
                  <span>{result.stressZoom.note}</span>
                </div>
                <div className="composition-backtest-stress-metrics">
                  <span>组合 {result.stressZoom.portfolioDrawdown}</span>
                  <span>{result.stressZoom.benchmarkLabel} {result.stressZoom.benchmarkDrawdown}</span>
                  <span>修复时间：{result.stressZoom.timeToRecovery}</span>
                </div>
              </article>
            </article>

            <aside className="panel composition-backtest-result-panel composition-backtest-kpi-rail">
              <div className="composition-backtest-panel-header">
                <div>
                  <h2>核心指标</h2>
                  <p>先读结论，再下钻订单与证据。</p>
                </div>
              </div>
              <div className="composition-backtest-hero-metrics" aria-label="核心回测指标">
                {heroMetrics.map((metric) => (
                  <article className={getToneClassName('composition-backtest-hero-metric', metric.tone)} key={metric.key}>
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <p>{metric.detail}</p>
                  </article>
                ))}
              </div>
              <div className="composition-backtest-insight-list">
                {result.diagnosisJumps.map((jump) => (
                  <article className="composition-backtest-insight-card" key={jump.id}>
                    <strong>{jump.title}</strong>
                    <span>{jump.body}</span>
                    <button className="composition-backtest-text-button" onClick={() => jumpToOrders(jump)} type="button">
                      查看订单明细
                    </button>
                  </article>
                ))}
              </div>
            </aside>
          </section>

          <section className="panel composition-backtest-result-panel">
            <div className="composition-backtest-panel-header">
              <div>
                <h2>绩效指标矩阵</h2>
                <p>按周期纵向对比收益、风险和裁决，长周期缺口不再挤在表格右侧。</p>
              </div>
              <span className="status-chip status-chip--warning">30Y 不足</span>
            </div>
            <div className="composition-backtest-performance-cards">
              {performanceComparisons.map((group) => (
                <article className={getToneClassName('composition-backtest-performance-card', group.tone)} key={group.key}>
                  <div className="composition-backtest-performance-card__head">
                    <strong>{group.label}</strong>
                    <span>{group.status}</span>
                  </div>
                  <div className="composition-backtest-performance-card__rows">
                    {group.rows.map((row) => (
                      <div className={row.weak ? 'composition-backtest-performance-row is-weak' : 'composition-backtest-performance-row'} key={row.key}>
                        <span>{row.label}</span>
                        <strong>{row.value}</strong>
                        <small>{row.conclusion}</small>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <p className="composition-backtest-proxy-note">{result.proxyCoverageNote}</p>
          </section>

          <section className="composition-backtest-two-column">
            <article className="panel composition-backtest-result-panel composition-backtest-attribution-panel">
              <div className="composition-backtest-panel-header">
                <div>
                  <h2>Sleeve 贡献归因</h2>
                  <p>说明谁贡献收益、谁放大 Beta、谁制造水下时间。</p>
                </div>
              </div>
              <div className="composition-backtest-attribution-list">
                {result.sleeveContributions.map((item) => (
                  <article className="composition-backtest-attribution-card" key={item.key}>
                      <div>
                        <strong>{item.name}</strong>
                        <p>{item.detail}</p>
                      </div>
                    <div className="composition-backtest-attribution-badges">
                      <span className={getToneClassName('composition-backtest-mini-status', item.tone)}>{item.primary}</span>
                      <span className="composition-backtest-mini-status">效率 {item.efficiency}</span>
                    </div>
                    <div className={`composition-backtest-progress composition-backtest-progress--${item.tone}`}>
                      <span style={{ width: `${Math.min(Math.max(item.valuePct, 4), 100)}%` }} />
                    </div>
                  </article>
                ))}
              </div>
              <div className="composition-backtest-linked-risk">
                <div className="composition-backtest-panel-header composition-backtest-panel-header--compact">
                  <div>
                    <h2>Top 5 穿透风险</h2>
                    <p>与上方 Sleeve 贡献同屏复核，避免只看策略层收益。</p>
                  </div>
                  <span className="status-chip status-chip--warning">{concentrationAlert}</span>
                </div>
                <div className="composition-backtest-concentration-grid composition-backtest-concentration-grid--compact">
                  {result.concentrationTop5.map((holding) => (
                    <article className={getToneClassName('composition-backtest-holding-card', holding.tone)} key={holding.symbol}>
                      <div>
                        <strong>{holding.symbol}</strong>
                        <span>{holding.detail}</span>
                      </div>
                      <strong>{holding.weightPct.toFixed(1)}%</strong>
                    </article>
                  ))}
                </div>
              </div>
            </article>

            <article className="panel composition-backtest-result-panel composition-backtest-exposure-panel">
                <div className="composition-backtest-panel-header">
                  <div>
                  <h2>敞口热力图</h2>
                  <p>权重结构按调仓期展开，长说明已收进提示。</p>
                </div>
                <span
                  aria-label="敞口热力图审计说明"
                  className="composition-backtest-info-dot"
                  title={result.exposureAuditNote}
                >
                  i
                </span>
              </div>
              <div className="composition-backtest-exposure-legend" aria-label="敞口颜色图例">
                <span className="composition-backtest-legend-item composition-backtest-legend-item--portfolio">动量腿</span>
                <span className="composition-backtest-legend-item composition-backtest-legend-item--benchmark">QQQ</span>
                <span className="composition-backtest-legend-item composition-backtest-legend-item--cost">短债</span>
                <span className="composition-backtest-legend-item composition-backtest-legend-item--cash">现金</span>
              </div>
              <div className="composition-backtest-exposure-list">
                {result.exposureRows.map((row) => (
                  <article className="composition-backtest-exposure-row" key={row.key}>
                    <span>{row.period}</span>
                    <div className="composition-backtest-exposure-track">
                      <span className="composition-backtest-stack-alpha" style={{ width: `${row.alphaPct}%` }} title={`动量腿 ${row.alphaPct}%`} />
                      <span className="composition-backtest-stack-qqq" style={{ width: `${row.qqqPct}%` }} title={`QQQ ${row.qqqPct}%`} />
                      <span className="composition-backtest-stack-bill" style={{ width: `${row.billPct}%` }} title={`短债 ${row.billPct}%`} />
                      <span className="composition-backtest-stack-cash" style={{ width: `${row.cashPct}%` }} title={`现金 ${row.cashPct}%`} />
                    </div>
                    <span className="composition-backtest-exposure-note">
                      <strong>{row.label}</strong>
                    </span>
                  </article>
                ))}
              </div>
            </article>
          </section>

        </div>
      ) : null}

      {activeTab === 'orders' ? (
        <div className="composition-backtest-result-tab-panel" role="tabpanel" aria-label="订单">
          <section className="panel composition-backtest-result-panel">
            <div className="composition-backtest-orders-toolbar">
              <div>
                <h2>订单</h2>
                <p>再平衡事件、全量流水与内部对冲穿透。</p>
              </div>
              <div className="composition-backtest-orders-actions">
                <div className="composition-backtest-mode-switch" aria-label="订单视图切换" role="group">
                  <button className={orderMode === 'events' ? 'is-active' : ''} onClick={() => setOrderMode('events')} type="button">
                    按事件查看
                  </button>
                  <button className={orderMode === 'ledger' ? 'is-active' : ''} onClick={() => setOrderMode('ledger')} type="button">
                    查看全量流水
                  </button>
                </div>
                <div className="composition-backtest-export">
                  <button className="ghost-button" onClick={() => setExportMenuOpen((open) => !open)} type="button">
                    导出全量明细
                  </button>
                  {exportMenuOpen ? (
                    <div className="composition-backtest-export-menu" role="menu" aria-label="导出格式">
                      <button onClick={() => exportLedger('csv')} role="menuitem" type="button">CSV</button>
                      <button onClick={() => exportLedger('excel')} role="menuitem" type="button">Excel</button>
                    </div>
                  ) : null}
                  {exportStatus ? <span className="composition-backtest-export-status">{exportStatus}</span> : null}
                </div>
              </div>
            </div>
          </section>

          {orderMode === 'events' ? (
            <>
              <section className="composition-backtest-two-column">
                <article className="panel composition-backtest-result-panel">
                  <div className="composition-backtest-panel-header">
                    <div>
                      <h2>调仓事件</h2>
                      <p>按时间点聚合总额、摩擦成本、触发原因和后续有效性。</p>
                    </div>
                    <span className="status-chip status-chip--soft">事件视图</span>
                  </div>
                  <div className="composition-backtest-event-list">
                    {result.events.map((event) => (
                      <button
                        className={event.id === selectedEvent?.id ? 'composition-backtest-event-card is-active' : 'composition-backtest-event-card'}
                        key={event.id}
                        onClick={() => {
                          setSelectedEventId(event.id);
                          setSelectedOrderId('');
                        }}
                        type="button"
                      >
                        <strong>{event.title}</strong>
                        <span>总额 <strong>{event.totalAmount}</strong></span>
                        <span>摩擦成本 <strong>{event.frictionCost}</strong></span>
                        <span>触发原因 <strong>{event.triggerReason}</strong></span>
                        <span>有效性 <strong>{event.effectiveness}</strong></span>
                      </button>
                    ))}
                  </div>
                </article>

                <article className="panel composition-backtest-result-panel">
                  <div className="composition-backtest-panel-header">
                    <div>
                      <h2>穿透订单</h2>
                      <p>当前选中 {selectedEvent?.title ?? '暂无事件'}。</p>
                    </div>
                    <span className="status-chip status-chip--success">内部对冲</span>
                  </div>
                  <div className="composition-backtest-table-shell">
                    <table className="composition-backtest-table">
                      <thead>
                        <tr>
                          <th>标的</th>
                          <th>方向</th>
                          <th>成交价</th>
                          <th>来源策略腿</th>
                          <th>内部对冲</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedEvent?.orders ?? []).map((order) => (
                          <tr className={order.id === selectedOrderId ? 'is-highlighted' : ''} key={order.id}>
                            <td>{order.symbol}</td>
                            <td><span className={getToneClassName('composition-backtest-mini-status', order.tone)}>{order.side}</span></td>
                            <td>{order.price}</td>
                            <td>{order.sleeve}</td>
                            <td>
                              {order.netting ? (
                                <button
                                  className="composition-backtest-netting-button"
                                  onClick={() => {
                                    setSelectedOrderId(order.id);
                                    setSelectedNetting(order.netting ?? null);
                                  }}
                                  type="button"
                                >
                                  {order.nettingLabel}
                                </button>
                              ) : (
                                <span className={getToneClassName('composition-backtest-mini-status', order.tone)}>{order.nettingLabel}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {selectedOrder?.netting ?? selectedEvent?.orders.find((order) => order.netting)?.netting ? (
                    <article className="composition-backtest-netting-card">
                      <span className="status-chip status-chip--success">内部对冲穿透</span>
                      <strong>{(selectedOrder?.netting ?? selectedEvent?.orders.find((order) => order.netting)?.netting)?.title}</strong>
                      <p>{(selectedOrder?.netting ?? selectedEvent?.orders.find((order) => order.netting)?.netting)?.explanation}</p>
                    </article>
                  ) : null}
                </article>
              </section>

              <section className="panel composition-backtest-result-panel">
                <div className="composition-backtest-panel-header">
                  <div>
                    <h2>调仓效率</h2>
                    <p>每次调仓的滑点、手续费、后续贡献与订单明细定位。</p>
                  </div>
                </div>
                <div className="composition-backtest-table-shell">
                  <table className="composition-backtest-table">
                    <thead>
                      <tr>
                        <th>事件</th>
                        <th>触发</th>
                        <th>后续贡献</th>
                        <th>滑点</th>
                        <th>手续费</th>
                        <th>订单明细</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.efficiencyRows.map((row) => (
                        <tr key={row.id}>
                          <td>{row.event}</td>
                          <td>{row.trigger}</td>
                          <td>{row.contribution}</td>
                          <td>{row.slippage}</td>
                          <td>{row.fee}</td>
                          <td>{row.detailLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          ) : (
            <section className="panel composition-backtest-result-panel">
              <div className="composition-backtest-panel-header">
                <div>
                  <h2>全量流水</h2>
                  <p>全量交易清单，展示回测区间内所有成交。</p>
                </div>
                <span className="status-chip status-chip--soft">全量交易清单</span>
              </div>
              <div className="composition-backtest-filter-stack" aria-label="流水过滤">
                <div className="composition-backtest-filter-bar" role="group" aria-label="来源腿过滤">
                  <span>来源腿</span>
                  {['全部', ...sourceLegs].map((sourceLeg) => (
                    <button
                      className={sourceLegFilter === sourceLeg ? 'is-active' : ''}
                      key={sourceLeg}
                      onClick={() => {
                        setSourceLegFilter(sourceLeg);
                        setSymbolFilter('全部');
                      }}
                      type="button"
                    >
                      {sourceLeg}
                    </button>
                  ))}
                </div>
                <div className="composition-backtest-filter-bar" role="group" aria-label="标的过滤">
                  <span>标的</span>
                  {['全部', ...symbols].map((symbol) => (
                    <button
                      className={symbolFilter === symbol ? 'is-active' : ''}
                      key={symbol}
                      onClick={() => setSymbolFilter(symbol)}
                      type="button"
                    >
                      {symbol}
                    </button>
                  ))}
                </div>
              </div>
              <div className="composition-backtest-table-shell">
                <table className="composition-backtest-table composition-backtest-ledger-table">
                  <thead>
                    <tr>
                      <th>时间</th>
                      <th>标的</th>
                      <th>方向</th>
                      <th>数量</th>
                      <th>成交价</th>
                      <th>滑点(bps)</th>
                      <th>手续费($)</th>
                      <th>来源腿</th>
                      <th>触发原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleLedgerRows.map((row) => (
                      <tr key={row.id}>
                        <td>{row.time}</td>
                        <td>{row.symbol}</td>
                        <td><span className={getToneClassName('composition-backtest-mini-status', row.tone)}>{row.side}</span></td>
                        <td>{row.quantity}</td>
                        <td>{row.price}</td>
                        <td>{row.slippageBps}</td>
                        <td>{row.fee}</td>
                        <td>{row.sleeve}</td>
                        <td>{row.triggerReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      ) : null}

      {activeTab === 'evidence' ? (
        <div className="composition-backtest-result-tab-panel" role="tabpanel" aria-label="证据">
          <section className="panel composition-backtest-result-panel">
            <div className="composition-backtest-panel-header">
              <div>
                <h2>证据</h2>
                <p>配置快照、数据足迹、代理日志、算法规则与审计轨迹。</p>
              </div>
              <span className="status-chip status-chip--success">证据已留痕</span>
            </div>
            <div className="composition-backtest-evidence-grid">
              {result.evidenceCards.map((card) => (
                <article className={getToneClassName('composition-backtest-evidence-card', card.tone)} key={card.id}>
                  <strong>{card.title}</strong>
                  <span>{card.body}</span>
                </article>
              ))}
            </div>
          </section>

          <section className="panel composition-backtest-result-panel">
            <div className="composition-backtest-panel-header">
              <div>
                <h2>代理日志</h2>
                <p>代理映射清单记录缺失时段、代理源、相关度和用途。</p>
              </div>
            </div>
            <div className="composition-backtest-table-shell">
              <table className="composition-backtest-table">
                <thead>
                  <tr>
                    <th>时段</th>
                    <th>缺失腿</th>
                    <th>代理</th>
                    <th>相关度</th>
                    <th>用途</th>
                  </tr>
                </thead>
                <tbody>
                  {result.proxyLogs.map((row) => (
                    <tr key={row.id}>
                      <td>{row.period}</td>
                      <td>{row.missingSleeve}</td>
                      <td>{row.proxy}</td>
                      <td>{row.correlation}</td>
                      <td>{row.usage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel composition-backtest-result-panel">
            <div className="composition-backtest-panel-header">
              <div>
                <h2>审计轨迹</h2>
                <p>run id、配置指纹、数据门禁和算法锁定事件。</p>
              </div>
            </div>
            <div className="composition-backtest-audit-list">
              {result.auditTrail.map((item) => (
                <article className="composition-backtest-audit-card" key={item.id}>
                  <strong>{item.title}</strong>
                  {item.at ? <span>{item.at}</span> : null}
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {selectedNetting ? (
        <div className="composition-backtest-dialog-shell" onClick={() => setSelectedNetting(null)} role="presentation">
          <div
            aria-label="内部对冲明细"
            aria-modal="true"
            className="composition-backtest-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="composition-backtest-panel-header">
              <div>
                <p className="page-heading__eyebrow">内部对冲</p>
                <h2>{selectedNetting.title}</h2>
                <p>{selectedNetting.explanation}</p>
              </div>
              <button className="ghost-button" onClick={() => setSelectedNetting(null)} type="button">关闭</button>
            </div>
            <div className="composition-backtest-netting-grid">
              <div><span>原始卖出需求</span><strong>{selectedNetting.rawSellDemand}</strong></div>
              <div><span>原始买入需求</span><strong>{selectedNetting.rawBuyDemand}</strong></div>
              <div><span>内部撮合数量</span><strong>{selectedNetting.internalMatch}</strong></div>
              <div><span>最终外部成交数量</span><strong>{selectedNetting.externalQuantity}</strong></div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export type { CompositionBacktestResult, CompositionBacktestResultPageProps, ExportFormat };

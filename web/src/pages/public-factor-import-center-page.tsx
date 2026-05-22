import { useEffect, useMemo, useState } from 'react';
import './public-factor-import-center-page.css';

type SourceKind = 'auto' | 'manual' | 'reference';
type SourceTone = 'ready' | 'warning' | 'reference';
type DatasetStatus = 'importable' | 'review' | 'reference';
type ModalKind = 'precheck' | 'local-file' | null;
type EntryMode = 'precheck' | 'local-file';
type DatasetFilter = 'all' | DatasetStatus;

export type PublicFactorImportSource = {
  id: string;
  name: string;
  category?: string;
  kind: SourceKind;
  tone: SourceTone;
  frequency: string;
  badges: string[];
  description: string;
};

export type PublicFactorImportDataset = {
  id: string;
  name: string;
  key: string;
  sourceName: string;
  frequency: string;
  coverage: string;
  status: DatasetStatus;
  fieldCount?: number;
  statusLabel?: string;
  actionLabel?: string;
};

export type PublicFactorImportMapping = {
  externalColumn: string;
  fullName: string;
  family: string;
  usage: string;
  tags: string[];
};

export type PublicFactorImportManifest = {
  jobId: string;
  sourceName: string;
  datasetKey: string;
  asOfDate: string;
  parserVersion: string;
  rawFileHash: string;
  rowCount: number;
  artifactPath: string;
  reviewNote: string;
  reviewStatus?: string;
  nextActions?: string[];
  submitReady?: boolean;
};

export type PublicFactorImportViewModel = {
  sources: PublicFactorImportSource[];
  datasets: PublicFactorImportDataset[];
  mappings: PublicFactorImportMapping[];
  mappingsByDataset?: Record<string, PublicFactorImportMapping[]>;
  manifest: PublicFactorImportManifest;
  activeSourceId: string;
  activeDatasetId: string;
  updatedAtLabel?: string;
};

export type PublicFactorImportApi = {
  loadViewModel?: () => Promise<Partial<PublicFactorImportViewModel> | null | undefined>;
  createPrecheck?: (payload: {
    sourceId: string;
    datasetId: string;
    frequency: string;
    usage: string;
    parserMode: string;
    boundary: string;
    note: string;
  }) => Promise<Partial<PublicFactorImportViewModel> | null | undefined | unknown>;
  importLocalFile?: (payload: {
    file: File | null;
    sourceId: string;
    datasetId: string;
    frequency: string;
    sourceTemplate: boolean;
    manifestTemplate: boolean;
    mappingTemplate: boolean;
  }) => Promise<Partial<PublicFactorImportViewModel> | null | undefined | unknown>;
  submitReview?: (payload: { jobId: string }) => Promise<Partial<PublicFactorImportViewModel> | null | undefined | unknown>;
};

export type PublicFactorImportCenterPageProps = {
  viewModel?: Partial<PublicFactorImportViewModel>;
  api?: PublicFactorImportApi;
};

const FALLBACK_VIEW_MODEL: PublicFactorImportViewModel = {
  activeSourceId: 'french',
  activeDatasetId: 'ff5-daily',
  updatedAtLabel: '本地预览视图',
  sources: [
    {
      id: 'french',
      name: 'French-Data Library',
      category: '学术基准',
      kind: 'auto',
      tone: 'ready',
      frequency: '日频 / 月频',
      badges: ['可自动导入'],
      description: 'FF3、FF5、Momentum，默认进入估值、质量与基准模板。',
    },
    {
      id: 'aqr',
      name: 'AQR Data Library',
      category: '许可待确认',
      kind: 'manual',
      tone: 'warning',
      frequency: '日频 / 月频',
      badges: ['手动上传'],
      description: 'QMJ 与 TSMOM 先作为风险调整与动量参数模板。',
    },
    {
      id: 'msci',
      name: 'MSCI FaCS',
      category: '参考源',
      kind: 'reference',
      tone: 'reference',
      frequency: '行业暴露',
      badges: ['人工参考'],
      description: '用于 max_cap 与行业暴露上限，不生成自动下载作业。',
    },
    {
      id: 'pv',
      name: 'Portfolio Visualizer',
      category: '参考源',
      kind: 'reference',
      tone: 'reference',
      frequency: 'Factor Regression',
      badges: ['参数参考'],
      description: '用于风格表现观察，模板生成后需人工填写来源证据。',
    },
  ],
  datasets: [
    {
      id: 'ff5-daily',
      name: 'Fama-French 5 Factors Daily',
      key: 'ff_us_5f_daily',
      sourceName: 'French',
      frequency: '日频',
      coverage: '1963-07 至今',
      status: 'importable',
      fieldCount: 6,
      statusLabel: '候选模板',
      actionLabel: '查看 manifest',
    },
    {
      id: 'mom-daily',
      name: 'Fama-French Momentum',
      key: 'ff_us_mom_daily',
      sourceName: 'French',
      frequency: '日频',
      coverage: '1926-11 至今',
      status: 'importable',
      fieldCount: 2,
      statusLabel: '可生成模板',
      actionLabel: '生成模板',
    },
    {
      id: 'aqr-qmj',
      name: 'AQR QMJ Daily',
      key: 'aqr_us_qmj_daily',
      sourceName: 'AQR',
      frequency: '日频',
      coverage: '人工确认',
      status: 'review',
      fieldCount: 4,
      statusLabel: '需许可确认',
      actionLabel: '送入复核',
    },
    {
      id: 'aqr-tsmom',
      name: 'AQR TSMOM Monthly',
      key: 'aqr_tsmom_monthly',
      sourceName: 'AQR',
      frequency: '月频',
      coverage: '人工确认',
      status: 'reference',
      fieldCount: 3,
      statusLabel: '手动上传',
      actionLabel: '重新解析',
    },
  ],
  mappings: [
    {
      externalColumn: 'SMB',
      fullName: 'Small Minus Big',
      family: '规模族底稿',
      usage: 'F2 候选模板，不直接发布',
      tags: ['基准模板', '需检疫'],
    },
    {
      externalColumn: 'HML',
      fullName: 'High Minus Low',
      family: '估值族底稿',
      usage: '用于 FFBlend 或暴露解释',
      tags: ['风格参考', '需检疫'],
    },
    {
      externalColumn: 'RMW',
      fullName: 'Robust Minus Weak',
      family: '质量族底稿',
      usage: '盈利能力多空模板',
      tags: ['质量参考', '需检疫'],
    },
    {
      externalColumn: 'CMA',
      fullName: 'Conservative Minus Aggressive',
      family: '投资族底稿',
      usage: '投资风格多空模板',
      tags: ['治理参考', '需检疫'],
    },
    {
      externalColumn: 'MKT-RF',
      fullName: 'Market Minus Risk Free',
      family: '市场超额收益底稿',
      usage: '用于基准解释与超额收益对齐',
      tags: ['基准字段', '需检疫'],
    },
  ],
  mappingsByDataset: {
    'mom-daily': [
      {
        externalColumn: 'UMD',
        fullName: 'Up Minus Down',
        family: 'Momentum style',
        usage: 'F2 momentum sleeve input for factor blend review.',
        tags: ['French', 'Momentum'],
      },
      {
        externalColumn: 'MOM',
        fullName: 'Prior 12-2 Month Momentum',
        family: 'Trend persistence',
        usage: 'Maps into medium-horizon price continuation diagnostics.',
        tags: ['Return signal', 'Review'],
      },
    ],
    'aqr-qmj': [
      {
        externalColumn: 'QMJ',
        fullName: 'Quality Minus Junk',
        family: 'Quality composite',
        usage: 'Primary AQR quality sleeve for profitability, growth, and safety review.',
        tags: ['AQR', 'Quality'],
      },
      {
        externalColumn: 'PROF',
        fullName: 'Profitability Quality',
        family: 'Profitability',
        usage: 'Maps into GSL quality family as an earnings-strength component.',
        tags: ['AQR', 'Profitability'],
      },
      {
        externalColumn: 'GROWTH',
        fullName: 'Growth Quality',
        family: 'Growth quality',
        usage: 'Maps into growth family after standard-rank normalization.',
        tags: ['AQR', 'Growth'],
      },
      {
        externalColumn: 'SAFETY',
        fullName: 'Safety Quality',
        family: 'Low-risk quality',
        usage: 'Feeds downside-risk adjusted quality diagnostics.',
        tags: ['AQR', 'Risk-adjusted'],
      },
    ],
    'aqr-tsmom': [
      {
        externalColumn: 'TSMOM',
        fullName: 'Time Series Momentum',
        family: 'Absolute momentum',
        usage: 'Reference signal for trend-following parameter calibration.',
        tags: ['AQR', 'Reference'],
      },
      {
        externalColumn: 'EQ_TSMOM',
        fullName: 'Equity Time Series Momentum',
        family: 'Equity trend',
        usage: 'Maps into equity-only trend diagnostics before strategy synthesis.',
        tags: ['Equity', 'Momentum'],
      },
      {
        externalColumn: 'FI_TSMOM',
        fullName: 'Fixed Income Time Series Momentum',
        family: 'Rates trend',
        usage: 'Reference-only mapping for cross-asset factor research.',
        tags: ['Rates', 'Reference'],
      },
    ],
  },
  manifest: {
    jobId: 'imp_20260521_ff5_001',
    sourceName: 'French-Data Library',
    datasetKey: 'ff_us_5f_daily',
    asOfDate: '2026-05-21',
    parserVersion: 'ff_parser_v0.1',
    rawFileHash: 'sha256:9f34...c21b',
    rowCount: 15842,
    artifactPath: 'artifacts/factor-import/french/imp_20260521_ff5_001',
    reviewNote:
      '公开因子模板只进入 D2 检疫或人工复核。正式发布必须拥有 PIT 覆盖、RankIC/IR 证据和治理审批。',
  },
};

const METRIC_LABELS = [
  { label: '可自动导入', detail: 'French 与本地上传源已通过预检' },
  { label: '参考源', detail: 'MSCI FaCS 与 Portfolio Visualizer' },
  { label: '待复核', detail: 'AQR 自动下载许可待确认' },
  { label: '最近 manifest', detail: '全部保留 hash 与 parser 版本' },
];

const FLOW_STEPS = [
  { title: '来源准备', body: '登记公开源，或选择本地导入模板。' },
  { title: '获取 / 上传', body: '自动下载公开文件，或上传 CSV / XLSX。' },
  { title: '新建预检', body: '记录字段、日期范围、hash 与 parser 版本。' },
  { title: '语义映射', body: '对齐 GSL 因子族、层级和治理用途。' },
  { title: '送入复核', body: '进入 D2 检疫或人工复核队列。' },
];

const ENTRY_OPTIONS: Array<{
  mode: EntryMode;
  title: string;
  body: string;
}> = [
  {
    mode: 'precheck',
    title: '入口 A · 公开源预检',
    body: '选择 French 或 AQR 等来源，直接发起预检，自动获取文件并生成 manifest。',
  },
  {
    mode: 'local-file',
    title: '入口 B · 本地文件导入',
    body: '先下载模板并上传文件，再创建预检，随后进入同一套映射与复核链路。',
  },
];

const DATASET_FILTERS: Array<{ key: DatasetFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'importable', label: '可导入' },
  { key: 'review', label: '待复核' },
  { key: 'reference', label: '参考' },
];

const TEMPLATE_LINKS = [
  {
    key: 'source',
    title: '公开源登记模板',
    href: '/factor-sources/templates/source_template.xlsx',
    label: '下载 source_template.xlsx',
    detail: 'source_id、许可、频率、下载方式与默认用途。',
  },
  {
    key: 'manifest',
    title: '数据集 manifest 模板',
    href: '/factor-sources/templates/manifest_template.xlsx',
    label: '下载 manifest_template.xlsx',
    detail: 'dataset_key、as_of_date、字段、hash 与 artifact 信息。',
  },
  {
    key: 'mapping',
    title: '语义映射模板',
    href: '/factor-sources/templates/mapping_template.xlsx',
    label: '下载 mapping_template.xlsx',
    detail: '外部列名、GSL 因子族、层级、用途与发布边界。',
  },
];

function mergeViewModel(
  base: PublicFactorImportViewModel,
  incoming?: Partial<PublicFactorImportViewModel> | null,
): PublicFactorImportViewModel {
  if (!incoming) {
    return base;
  }
  return {
    activeSourceId: incoming.activeSourceId || base.activeSourceId,
    activeDatasetId: incoming.activeDatasetId || base.activeDatasetId,
    updatedAtLabel: incoming.updatedAtLabel || base.updatedAtLabel,
    sources: incoming.sources?.length ? incoming.sources : base.sources,
    datasets: incoming.datasets?.length ? incoming.datasets : base.datasets,
    mappings: incoming.mappings?.length ? incoming.mappings : base.mappings,
    mappingsByDataset: incoming.mappingsByDataset || base.mappingsByDataset,
    manifest: incoming.manifest || base.manifest,
  };
}

function safeText(value: unknown, fallback = '待确认'): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return fallback;
}

function formatCount(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '待确认';
  }
  return new Intl.NumberFormat('zh-CN').format(value);
}

function isViewModelPatch(value: unknown): value is Partial<PublicFactorImportViewModel> {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const patch = value as Partial<PublicFactorImportViewModel>;
  return Boolean(
    patch.sources ||
    patch.datasets ||
    patch.mappings ||
    patch.mappingsByDataset ||
    patch.manifest ||
    patch.activeSourceId ||
    patch.activeDatasetId
  );
}

function sourceToneLabel(source: PublicFactorImportSource): string {
  if (source.tone === 'ready') {
    return source.kind === 'auto' ? '可自动导入' : '已准备';
  }
  if (source.tone === 'warning') {
    return '许可待确认';
  }
  return '参考源';
}

function datasetStatusLabel(status: DatasetStatus): string {
  if (status === 'importable') {
    return '可生成模板';
  }
  if (status === 'review') {
    return '需许可确认';
  }
  return '手动上传';
}

function datasetActionLabel(status: DatasetStatus): string {
  if (status === 'importable') {
    return '查看 manifest';
  }
  if (status === 'review') {
    return '送入复核';
  }
  return '重新解析';
}

function sourceMatchesDataset(
  source: PublicFactorImportSource | undefined,
  dataset: PublicFactorImportDataset,
): boolean {
  const sourceName = `${source?.id || ''} ${source?.name || ''}`.toLowerCase();
  const datasetSource = `${dataset.sourceName} ${dataset.id} ${dataset.key}`.toLowerCase();
  if (sourceName.includes('aqr')) {
    return datasetSource.includes('aqr');
  }
  if (sourceName.includes('french') || sourceName.includes('fama')) {
    return datasetSource.includes('french') || datasetSource.includes('ff_');
  }
  return false;
}

function datasetMatchesFilter(dataset: PublicFactorImportDataset, filter: DatasetFilter): boolean {
  return filter === 'all' || dataset.status === filter;
}

function sourceForDataset(
  sources: PublicFactorImportSource[],
  dataset: PublicFactorImportDataset,
): PublicFactorImportSource | undefined {
  return sources.find((source) => sourceMatchesDataset(source, dataset));
}

function mappingsForDataset(
  model: PublicFactorImportViewModel,
  dataset: PublicFactorImportDataset | undefined,
): PublicFactorImportMapping[] {
  const mappingKeys = [dataset?.id, dataset?.key].filter(Boolean) as string[];
  const datasetHaystack = mappingKeys.join(' ').toLowerCase();
  if (datasetHaystack.includes('qmj')) {
    mappingKeys.push('aqr-qmj');
  }
  if (datasetHaystack.includes('tsmom')) {
    mappingKeys.push('aqr-tsmom');
  }
  if (datasetHaystack.includes('mom')) {
    mappingKeys.push('mom-daily');
  }
  for (const mappingKey of mappingKeys) {
    const datasetMappings = model.mappingsByDataset?.[mappingKey];
    if (datasetMappings?.length) {
      return datasetMappings;
    }
  }
  return model.mappings;
}

export function PublicFactorImportCenterPage({
  viewModel,
  api,
}: PublicFactorImportCenterPageProps): JSX.Element {
  const [remoteViewModel, setRemoteViewModel] =
    useState<Partial<PublicFactorImportViewModel> | null>(null);
  const [entryMode, setEntryMode] = useState<EntryMode>('precheck');
  const [datasetFilter, setDatasetFilter] = useState<DatasetFilter>('all');
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const [activeDatasetId, setActiveDatasetId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [actionMessage, setActionMessage] = useState<string>('');

  useEffect(() => {
    let alive = true;
    if (!api?.loadViewModel) {
      return () => {
        alive = false;
      };
    }
    api
      .loadViewModel()
      .then((next) => {
        if (alive) {
          setRemoteViewModel(next || null);
        }
      })
      .catch(() => {
        if (alive) {
          setActionMessage('API 暂不可用，已切换到本地安全预览。');
        }
      });
    return () => {
      alive = false;
    };
  }, [api]);

  const model = useMemo(
    () => mergeViewModel(mergeViewModel(FALLBACK_VIEW_MODEL, remoteViewModel), viewModel),
    [remoteViewModel, viewModel],
  );

  const selectedSourceId = activeSourceId || model.activeSourceId;
  const selectedDatasetId = activeDatasetId || model.activeDatasetId;
  const activeSource =
    model.sources.find((source) => source.id === selectedSourceId) || model.sources[0];
  const activeDataset =
    model.datasets.find((dataset) => dataset.id === selectedDatasetId) || model.datasets[0];
  const activeMappings = mappingsForDataset(model, activeDataset);
  const visibleDatasets = model.datasets.filter((dataset) => datasetMatchesFilter(dataset, datasetFilter));
  const canSubmitReview = Boolean(model.manifest.submitReady && model.manifest.jobId.trim());

  const metrics = [
    model.sources.filter((source) => source.kind === 'auto').length + 1,
    model.sources.filter((source) => source.kind === 'reference').length,
    model.datasets.filter((dataset) => dataset.status === 'review').length,
    12,
  ];

  function closeModal(): void {
    setModal(null);
    setActionMessage('');
  }

  function openModal(nextModal: Exclude<ModalKind, null>): void {
    setEntryMode(nextModal === 'precheck' ? 'precheck' : 'local-file');
    setModal(nextModal);
  }

  function saveDraft(message: string): void {
    setModal(null);
    setActionMessage(message);
  }

  function selectSource(source: PublicFactorImportSource): void {
    setActiveSourceId(source.id);
    const firstDataset = model.datasets.find((dataset) => sourceMatchesDataset(source, dataset));
    if (firstDataset) {
      setActiveDatasetId(firstDataset.id);
    }
  }

  function selectDataset(dataset: PublicFactorImportDataset): void {
    setActiveDatasetId(dataset.id);
    const source = sourceForDataset(model.sources, dataset);
    if (source) {
      setActiveSourceId(source.id);
    }
  }

  function selectDatasetFilter(filter: DatasetFilter): void {
    setDatasetFilter(filter);
    const firstDataset = model.datasets.find((dataset) => datasetMatchesFilter(dataset, filter));
    if (firstDataset) {
      selectDataset(firstDataset);
    }
  }

  function applyApiResult(result: unknown): void {
    if (isViewModelPatch(result)) {
      setRemoteViewModel((current) => mergeViewModel(mergeViewModel(FALLBACK_VIEW_MODEL, current), result));
      if (result.activeSourceId) {
        setActiveSourceId(result.activeSourceId);
      }
      if (result.activeDatasetId) {
        setActiveDatasetId(result.activeDatasetId);
      }
    }
  }

  async function submitPrecheck(): Promise<void> {
    const payload = {
      sourceId: activeSource?.id || model.activeSourceId,
      datasetId: activeDataset?.id || model.activeDatasetId,
        frequency: activeDataset?.frequency || '日频',
      usage: '基准模板与风格暴露解释',
      parserMode: '公开下载后解析',
      boundary: '候选模板，不直接发布',
      note: '生成 manifest 后进入语义映射与复核链路。',
    };
    try {
      const result = await api?.createPrecheck?.(payload);
      applyApiResult(result);
      setActionMessage('预检已提交，manifest 与字段映射将进入复核链路。');
      setModal(null);
    } catch {
      setActionMessage('预检接口暂不可用，请保留草稿后重试。');
    }
  }

  async function submitLocalFile(): Promise<void> {
    try {
      const result = await api?.importLocalFile?.({
        file: selectedFile,
        sourceId: activeSource?.id || model.activeSourceId,
        datasetId: activeDataset?.id || model.activeDatasetId,
        frequency: activeDataset?.frequency || '日频',
        sourceTemplate: true,
        manifestTemplate: true,
        mappingTemplate: true,
      });
      applyApiResult(result);
      setActionMessage('本地文件已进入解析队列，后续仍需新建预检。');
      setModal(null);
    } catch {
      setActionMessage('上传接口暂不可用，文件已停留在本地选择状态。');
    }
  }

  async function submitReview(): Promise<void> {
    if (!canSubmitReview) {
      setActionMessage('请先新建预检，并确认语义映射与 manifest 状态为 READY_FOR_REVIEW。');
      return;
    }
    try {
      const result = await api?.submitReview?.({ jobId: model.manifest.jobId });
      applyApiResult(result);
      setActionMessage('已送入复核队列，后续仍需 D2 检疫与人工确认，不能直接发布。');
    } catch {
      setActionMessage('送入复核失败，请先完成语义映射并确认 manifest。');
    }
  }

  function handleDownloadManifest(): void {
    setActionMessage(`manifest 下载已准备：${model.manifest.jobId}`);
  }

  function handleOpenArtifact(): void {
    setActionMessage(`artifact 路径已确认：${model.manifest.artifactPath}`);
  }

  return (
    <main className="pfic-page" data-testid="public-factor-import-center">
      <section className="pfic-hero" aria-labelledby="pfic-title">
        <div className="pfic-hero-copy">
          <p className="pfic-kicker">PUBLIC FACTOR INGESTION</p>
          <h1 id="pfic-title">公开因子入库中心</h1>
          <p className="pfic-lede">
            先准备来源，再发起预检；通过语义映射后送入复核。
          </p>
          <div className="pfic-entry-grid" aria-label="入库入口">
            {ENTRY_OPTIONS.map((entry) => (
              <button
                type="button"
                className={
                  entryMode === entry.mode
                    ? 'pfic-entry-card pfic-entry-card-active'
                    : 'pfic-entry-card'
                }
                aria-pressed={entryMode === entry.mode}
                key={entry.mode}
                onClick={() => setEntryMode(entry.mode)}
              >
                <strong>{entry.title}</strong>
                <span>{entry.body}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="pfic-hero-actions">
          <button
            type="button"
            className="pfic-button pfic-button-secondary pfic-action-local-file"
            data-open-modal="local-file"
            onClick={() => openModal('local-file')}
          >
            导入本地文件
          </button>
          <button
            type="button"
            className="pfic-button pfic-button-primary pfic-action-create-precheck"
            data-open-modal="precheck"
            onClick={() => openModal('precheck')}
          >
            新建预检
          </button>
        </div>
      </section>

      {actionMessage ? <p className="pfic-inline-status">{actionMessage}</p> : null}

      <section className="pfic-kpi-strip import-kpi-strip" aria-label="入库摘要">
        {METRIC_LABELS.map((metric, index) => (
          <article className="pfic-kpi-card" key={metric.label}>
            <span>{metric.label}</span>
            <strong>{formatCount(metrics[index])}</strong>
            <p>{metric.detail}</p>
          </article>
        ))}
      </section>

      <section className="pfic-layout">
        <aside className="pfic-source-panel source-list">
          <div className="pfic-panel-heading">
            <div>
              <h2>公开源目录</h2>
              <p>来源、许可与默认用途</p>
            </div>
            <span>{formatCount(model.sources.length)} 个源</span>
          </div>
          <div className="pfic-source-list">
            {model.sources.map((source) => (
              <button
                type="button"
                key={source.id}
                className={`pfic-source-card pfic-source-card-${source.tone} ${
                  source.id === selectedSourceId ? 'pfic-source-card-selected' : ''
                }`}
                aria-pressed={source.id === selectedSourceId}
                onClick={() => selectSource(source)}
              >
                <span className="pfic-source-title">
                  <strong>{safeText(source.name)}</strong>
                  <em className={source.tone === 'ready' ? 'pfic-chip-blue' : 'pfic-chip-amber'}>
                    {safeText(source.category, sourceToneLabel(source))}
                  </em>
                </span>
                <span className="pfic-source-badges">
                  {source.badges.map((badge) => (
                    <i
                      className={badge.includes('自动') ? 'pfic-chip-green' : 'pfic-chip-amber'}
                      key={badge}
                    >
                      {badge}
                    </i>
                  ))}
                  <i className="pfic-chip-blue">{safeText(source.frequency)}</i>
                </span>
                <span className="pfic-source-description">{safeText(source.description)}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="pfic-flow-panel">
          <div className="pfic-panel-heading">
            <div>
              <h2>入库流程</h2>
              <p>公开源和本地文件汇入同一套预检、映射与复核链路</p>
            </div>
            <span>当前在语义映射</span>
          </div>
          <div className="pfic-flow-grid flow-steps">
            {FLOW_STEPS.map((step, index) => (
              <article className="pfic-flow-step" key={step.title}>
                <span>{index + 1}</span>
                <strong>{step.title}</strong>
                <p>{step.body}</p>
              </article>
            ))}
          </div>
        </section>

        <div className="pfic-main-stack">
          <section className="pfic-candidates dataset-panel">
            <div className="pfic-panel-heading">
              <div>
                <h2>候选数据集</h2>
                <p>按 source manifest 生成 preview</p>
              </div>
              <div className="pfic-segmented" aria-label="候选数据集筛选">
                {DATASET_FILTERS.map((filter) => (
                  <button
                    type="button"
                    aria-pressed={datasetFilter === filter.key}
                    key={filter.key}
                    onClick={() => selectDatasetFilter(filter.key)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="pfic-table-wrap">
              <table className="pfic-dataset-table dataset-table" aria-label="候选数据集">
                <thead>
                  <tr>
                    <th>数据集</th>
                    <th>来源</th>
                    <th>频率</th>
                    <th>时间范围</th>
                    <th>字段</th>
                    <th>状态</th>
                    <th>动作</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleDatasets.map((dataset) => {
                    const statusText = safeText(dataset.statusLabel, datasetStatusLabel(dataset.status));
                    const actionText = safeText(dataset.actionLabel, datasetActionLabel(dataset.status));
                    return (
                      <tr
                        className={dataset.id === selectedDatasetId ? 'pfic-dataset-row pfic-dataset-row-selected' : 'pfic-dataset-row'}
                        key={dataset.id}
                        onClick={() => selectDataset(dataset)}
                      >
                        <td>
                          <strong>{safeText(dataset.name)}</strong>
                          <small>{safeText(dataset.key)}</small>
                        </td>
                        <td>{safeText(dataset.sourceName)}</td>
                        <td>{safeText(dataset.frequency)}</td>
                        <td>{safeText(dataset.coverage)}</td>
                        <td>{formatCount(dataset.fieldCount)}</td>
                        <td>
                          <em className={dataset.status === 'review' || dataset.status === 'reference' ? 'pfic-chip-amber' : 'pfic-chip-green'}>
                            {statusText}
                          </em>
                        </td>
                        <td>
                          <button type="button" className="pfic-text-action" onClick={() => selectDataset(dataset)}>
                            {actionText}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="pfic-mapping-workbench mapping-workbench">
            <div className="pfic-panel-heading">
              <div>
                <h2>语义映射工作台</h2>
                <p>当前数据集：{safeText(activeDataset?.name, '待选择数据集')}</p>
              </div>
              <span>{formatCount(activeMappings.length)} / {formatCount(activeMappings.length)} 已映射</span>
            </div>
            <div className="pfic-mapping-grid">
              {activeMappings.map((mapping) => (
                <article className="pfic-mapping-card" key={`${activeDataset?.id || 'dataset'}-${mapping.externalColumn}`}>
                  <h3>{safeText(mapping.externalColumn)}</h3>
                  <p>{safeText(mapping.fullName)}</p>
                  <strong>{safeText(mapping.family)}</strong>
                  <span>{safeText(mapping.usage)}</span>
                  <div>
                    {mapping.tags.map((tag) => (
                      <em className={tag.includes('检疫') ? 'pfic-chip-amber' : 'pfic-chip-blue'} key={tag}>
                        {tag}
                      </em>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <dl className="pfic-mapping-rules">
              <div>
                <dt>标准化策略</dt>
                <dd>Standard-Rank 后进入候选模板</dd>
              </div>
              <div>
                <dt>发布边界</dt>
                <dd>禁止直接写入正式因子库</dd>
              </div>
              <div>
                <dt>默认用途</dt>
                <dd>综合族 F2 成分与暴露解释</dd>
              </div>
            </dl>
          </section>
        </div>

        <aside className="pfic-manifest-rail manifest-rail">
          <div className="pfic-panel-heading">
            <div>
              <h2>Manifest 审计</h2>
              <p>作业、hash 与 artifact 证据</p>
            </div>
            <span>已生成</span>
          </div>
          <section className="pfic-manifest-card">
            <h3>导入作业</h3>
            <dl>
              <div>
                <dt>作业 ID</dt>
                <dd>{safeText(model.manifest.jobId)}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>{safeText(model.manifest.sourceName)}</dd>
              </div>
              <div>
                <dt>数据集</dt>
                <dd>{safeText(model.manifest.datasetKey)}</dd>
              </div>
              <div>
                <dt>日期</dt>
                <dd>{safeText(model.manifest.asOfDate)}</dd>
              </div>
            </dl>
          </section>
          <section className="pfic-manifest-card">
            <h3>文件证据</h3>
            <dl>
              <div>
                <dt>parser</dt>
                <dd>{safeText(model.manifest.parserVersion)}</dd>
              </div>
              <div>
                <dt>raw hash</dt>
                <dd>{safeText(model.manifest.rawFileHash)}</dd>
              </div>
              <div>
                <dt>行数</dt>
                <dd>{formatCount(model.manifest.rowCount)}</dd>
              </div>
              <div>
                <dt>artifact</dt>
                <dd>{safeText(model.manifest.artifactPath)}</dd>
              </div>
            </dl>
          </section>
          <p className="pfic-review-note">{safeText(model.manifest.reviewNote)}</p>
          <button
            type="button"
            className="pfic-button pfic-button-primary"
            disabled={!canSubmitReview}
            onClick={() => void submitReview()}
          >
            送入复核
          </button>
          <button type="button" className="pfic-button pfic-button-secondary" onClick={handleDownloadManifest}>下载 manifest</button>
          <button type="button" className="pfic-button pfic-button-secondary" onClick={handleOpenArtifact}>打开 artifact</button>
        </aside>
      </section>

      {modal === 'precheck' ? (
        <PrecheckModal
          source={activeSource}
          dataset={activeDataset}
          onClose={closeModal}
          onSaveDraft={() => saveDraft('预检草稿已保存，后续可继续补充 manifest 与边界说明。')}
          onSubmit={() => void submitPrecheck()}
        />
      ) : null}
      {modal === 'local-file' ? (
        <LocalFileModal
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          onClose={closeModal}
          onSaveDraft={() => saveDraft('上传草稿已保存，模板与文件选择状态已记录在当前入库草稿。')}
          onSubmit={() => void submitLocalFile()}
        />
      ) : null}
    </main>
  );
}

function PrecheckModal({
  source,
  dataset,
  onClose,
  onSaveDraft,
  onSubmit,
}: {
  source?: PublicFactorImportSource;
  dataset?: PublicFactorImportDataset;
  onClose: () => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <div className="pfic-modal-backdrop" role="presentation">
      <section
        className="pfic-modal modal-precheck"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pfic-precheck-title"
      >
        <header className="pfic-modal-header">
          <div>
            <h2 id="pfic-precheck-title">新建预检</h2>
            <p>为公开源或已上传文件发起统一预检，生成 manifest、字段映射和复核边界。</p>
          </div>
          <button type="button" className="pfic-modal-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="pfic-modal-body pfic-modal-precheck-grid">
          <section className="pfic-modal-card pfic-precheck-form">
            <h3>预检配置</h3>
            <label>
              <span>公开源</span>
              <select defaultValue={source?.name || 'French-Data Library'}>
                <option>{safeText(source?.name, 'French-Data Library')}</option>
                <option>AQR Data Library</option>
              </select>
            </label>
            <label>
              <span>数据集</span>
              <select defaultValue={dataset?.name || 'Fama-French 5 Factors Daily'}>
                <option>{safeText(dataset?.name, 'Fama-French 5 Factors Daily')}</option>
                <option>AQR QMJ Daily</option>
              </select>
            </label>
            <label>
              <span>频率</span>
              <select defaultValue={dataset?.frequency || '日频'}>
                <option>{safeText(dataset?.frequency, '日频')}</option>
                <option>月频</option>
              </select>
            </label>
            <label>
              <span>默认用途</span>
              <select defaultValue="基准模板与风格暴露解释">
                <option>基准模板与风格暴露解释</option>
                <option>风险调整参考</option>
              </select>
            </label>
            <label>
              <span>解析方式</span>
              <select defaultValue="公开下载后解析">
                <option>公开下载后解析</option>
                <option>本地文件解析</option>
              </select>
            </label>
            <label>
              <span>入库边界</span>
              <input defaultValue="候选模板，不直接发布" />
            </label>
            <label className="pfic-form-wide">
              <span>预检备注</span>
              <textarea defaultValue="FF5 作为估值、质量、投资风格底稿；生成 manifest 后进入治理复核。" />
            </label>
          </section>
          <section className="pfic-modal-card">
            <h3>作业边界</h3>
            <div className="pfic-boundary-list">
              <article>
                <strong>生成候选模板</strong>
                <p>完成来源、字段、hash 与 parser 记录，不写入正式因子库。</p>
              </article>
              <article>
                <strong>送入人工复核</strong>
                <p>许可或字段缺口需要治理负责人确认。</p>
              </article>
              <article>
                <strong>暂存观察</strong>
                <p>只保留来源登记和预检日志，不生成候选模板。</p>
              </article>
            </div>
          </section>
          <section className="pfic-modal-card pfic-modal-output">
            <h3>预检输出</h3>
            <ol className="pfic-checklist">
              <li><span>1</span><p>生成导入作业编号、source manifest 与标准化字段映射。</p></li>
              <li><span>2</span><p>记录原始文件 hash、parser 版本、行列统计和 artifact 路径。</p></li>
              <li><span>3</span><p>公开因子只进入候选模板，正式发布仍需 D2 检疫与 RankIC/IR 证据。</p></li>
            </ol>
          </section>
        </div>
        <footer className="pfic-modal-footer">
          <button type="button" className="pfic-button pfic-button-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="pfic-button pfic-button-secondary" onClick={onSaveDraft}>
            保存草稿
          </button>
          <button type="button" className="pfic-button pfic-button-primary" onClick={onSubmit}>
            开始预检
          </button>
        </footer>
      </section>
    </div>
  );
}

function LocalFileModal({
  selectedFile,
  onSelectFile,
  onClose,
  onSaveDraft,
  onSubmit,
}: {
  selectedFile: File | null;
  onSelectFile: (file: File | null) => void;
  onClose: () => void;
  onSaveDraft: () => void;
  onSubmit: () => void;
}): JSX.Element {
  return (
    <div className="pfic-modal-backdrop" role="presentation">
      <section
        className="pfic-modal modal-import"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pfic-local-file-title"
      >
        <header className="pfic-modal-header">
          <div>
            <h2 id="pfic-local-file-title">导入本地文件</h2>
            <p>先下载标准模板并上传文件；上传通过后，可继续创建预检。</p>
          </div>
          <button type="button" className="pfic-modal-close" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="pfic-modal-body">
          <section className="pfic-modal-card">
            <h3>标准模板</h3>
            <div className="pfic-template-grid">
              {TEMPLATE_LINKS.map((template) => (
                <article key={template.key} className="pfic-template-card">
                  <strong>{template.title}</strong>
                  <p>{template.detail}</p>
                  <a className="pfic-template-link" href={template.href}>
                    {template.label}
                  </a>
                </article>
              ))}
            </div>
          </section>
          <div className="pfic-upload-grid">
            <section className="pfic-modal-card">
              <h3>上传文件</h3>
              <label className="pfic-file-drop">
                <input
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  onChange={(event) => onSelectFile(event.currentTarget.files?.[0] || null)}
                />
                <strong>拖入 CSV 或 XLSX 文件</strong>
                <span>
                  {selectedFile
                    ? `已选择：${selectedFile.name}`
                    : '支持单个数据集文件，文件名建议包含 source_id、dataset_key 与 as_of_date。'}
                </span>
              </label>
            </section>
            <section className="pfic-modal-card pfic-upload-checks">
              <h3>上传校验</h3>
              <ol className="pfic-checklist">
                <li><span>1</span><p>必须包含日期列和至少一个因子值列。</p></li>
                <li><span>2</span><p>必须填写来源 URL、访问方式和许可确认状态。</p></li>
                <li><span>3</span><p>直接发布边界固定为禁止。</p></li>
                <li><span>4</span><p>上传完成后先生成 manifest，再进入语义映射。</p></li>
              </ol>
            </section>
          </div>
        </div>
        <footer className="pfic-modal-footer">
          <button type="button" className="pfic-button pfic-button-secondary" onClick={onClose}>
            取消
          </button>
          <button type="button" className="pfic-button pfic-button-secondary" onClick={onSaveDraft}>
            保存上传草稿
          </button>
          <button type="button" className="pfic-button pfic-button-primary" onClick={onSubmit}>
            解析并生成 manifest
          </button>
        </footer>
      </section>
    </div>
  );
}

export default PublicFactorImportCenterPage;

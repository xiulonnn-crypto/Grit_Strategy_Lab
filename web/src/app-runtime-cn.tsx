import { startTransition, useEffect, useState } from 'react';
import { Component, lazy, Suspense } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { ApiClientProvider, useApiClient } from './lib/demoStoreContext';
import {
  AppRouteProvider,
  navigateTo,
  parseAppHash,
  type AppRoute,
} from './lib/appRouteContext';
import type {
  FactorMiningCandidate,
  FactorMiningCreatePayload,
  FactorMiningJob,
} from './pages/factor-sandbox-page';
import type {
  FactorModelCreateResponse,
  FactorModelOption,
  FactorModelPreview,
  FactorModelPreviewPayload,
  FactorModelStrategyCreationRisk,
} from './pages/factor-model-builder-page';
import { ShellFrameCn } from './shell-frame-cn';
import { StaticDemoCloudSync } from './components/static-demo-cloud-sync';
import { isStaticDemoSyncPanelRequested } from './lib/staticDemoApi';
import { formatFactorDisplayName } from './lib/factor-display';
import type {
  ApiExternalFactorImportJob,
  ApiExternalFactorFrequency,
  ApiExternalFactorSourceRegistryResponse,
  ApiFactorFactoryOverview,
  ApiFactorDiagnosticPreview,
  ApiFactorDirection,
  ApiFactorListItem,
  ApiFactorMiningCandidate as RuntimeMiningCandidate,
  ApiFactorMiningJob as RuntimeMiningJob,
} from './types';
import type {
  PublicFactorImportApi,
  PublicFactorImportManifest,
  PublicFactorImportViewModel,
} from './pages/public-factor-import-center-page';
import { CreationTemplatePage } from './pages/creation-template-page';

type ApiClient = ReturnType<typeof useApiClient>;
type FactorModelBuilderRoute = Extract<AppRoute, { kind: 'factor-model-builder' }>;
const FIRST_SCREEN_DEFER_MS = import.meta.env.MODE === 'test' ? 0 : 80;
const ROUTE_CHUNK_RELOAD_PREFIX = 'gsl:route-chunk-reload';
const FACTOR_CATEGORY_LABELS: Record<string, string> = {
  mom: '动量',
  val: '估值',
  qlty: '质量',
  vol: '风险',
  size: '规模',
  alpha: '其他',
  beta: '风险',
  inv: '质量',
  liq: '情绪',
  risk: '风险',
  sentiment: '情绪',
  style: '风格',
};

function normalizePublicFactorSourceId(value: string): string {
  const normalized = String(value || '').trim();
  const aliases: Record<string, string> = {
    french: 'fama_french',
    'fama-french': 'fama_french',
    vibe: 'vibe_alpha_zoo',
    'vibe-trading': 'vibe_alpha_zoo',
    'vibe-alpha-zoo': 'vibe_alpha_zoo',
    msci: 'msci_facs',
    pv: 'portfolio_visualizer',
  };
  return aliases[normalized] ?? normalized;
}

function normalizePublicFactorDatasetKey(value: string): string {
  const normalized = String(value || '').trim();
  const aliases: Record<string, string> = {
    'ff5-daily': 'fama_french_us_research_factors_daily',
    'mom-daily': 'fama_french_us_research_factors_daily',
    'aqr-qmj': 'aqr_public_style_factors',
    'aqr-tsmom': 'aqr_public_style_factors',
    'vibe-qlib158': 'vibe_qlib158',
    'vibe-alpha101': 'vibe_alpha101',
    'vibe-gtja191': 'vibe_gtja191',
    'vibe-academic': 'vibe_academic',
  };
  return aliases[normalized] ?? normalized;
}

function normalizePublicFactorFrequency(value: string): ApiExternalFactorFrequency {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized.includes('DAILY') || normalized.includes('日')) return 'DAILY';
  if (normalized.includes('MONTH') || normalized.includes('月')) return 'MONTHLY';
  if (normalized.includes('QUARTER') || normalized.includes('季')) return 'QUARTERLY';
  if (normalized.includes('ANNUAL') || normalized.includes('年')) return 'ANNUAL';
  return 'MIXED';
}

function publicFactorFrequencyLabel(value: string | null | undefined): string {
  switch (normalizePublicFactorFrequency(String(value || ''))) {
    case 'DAILY':
      return '日频';
    case 'MONTHLY':
      return '月频';
    case 'QUARTERLY':
      return '季频';
    case 'ANNUAL':
      return '年频';
    default:
      return '混合频率';
  }
}

function publicFactorSourceKind(accessPolicy: string): PublicFactorImportViewModel['sources'][number]['kind'] {
  const policy = String(accessPolicy || '').toUpperCase();
  if (policy === 'REFERENCE_ONLY') return 'reference';
  if (policy === 'LICENSE_REQUIRED' || policy === 'MANUAL_UPLOAD') return 'manual';
  return 'auto';
}

function publicFactorSourceTone(accessPolicy: string): PublicFactorImportViewModel['sources'][number]['tone'] {
  const policy = String(accessPolicy || '').toUpperCase();
  if (policy === 'REFERENCE_ONLY') return 'reference';
  if (policy === 'LICENSE_REQUIRED' || policy === 'MANUAL_UPLOAD') return 'warning';
  return 'ready';
}

function publicFactorDatasetStatus(status: string): PublicFactorImportViewModel['datasets'][number]['status'] {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'REFERENCE_ONLY') return 'reference';
  if (normalized === 'MANUAL_REQUIRED') return 'review';
  return 'importable';
}

function findPublicFactorSource(
  registry: ApiExternalFactorSourceRegistryResponse,
  ...needles: string[]
): ApiExternalFactorSourceRegistryResponse['sources'][number] | undefined {
  return registry.sources.find((source) => {
    const haystack = `${source.id} ${source.name} ${source.short_name}`.toLowerCase();
    return needles.some((needle) => haystack.includes(needle.toLowerCase()));
  });
}

function publicFactorDatasetId(
  source: ApiExternalFactorSourceRegistryResponse['sources'][number] | undefined,
  index: number,
  fallback: string,
): string {
  return source?.datasets[index]?.key || fallback;
}

function runtimeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function runtimeString(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function runtimeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function runtimeTime(...values: unknown[]): number {
  return values.reduce<number>((latest, value) => {
    const parsed = Date.parse(runtimeString(value));
    return Number.isFinite(parsed) ? Math.max(latest, parsed) : latest;
  }, 0);
}

function externalImportJobIdsFromOverview(
  overview: ApiFactorFactoryOverview | null | undefined,
  limit = 8,
): string[] {
  const snapshots: Array<{ jobId: string; updatedAt: number }> = [];
  for (const item of overview?.external_import_precheck_jobs?.items || []) {
    const jobId = runtimeString(item.id);
    if (jobId) {
      snapshots.push({
        jobId,
        updatedAt: runtimeTime(item.updated_at, item.submitted_at),
      });
    }
  }
  for (const item of overview?.external_import_review_queue?.items || []) {
    const jobId = runtimeString(item.id);
    if (jobId) {
      snapshots.push({
        jobId,
        updatedAt: runtimeTime(item.updated_at, item.submitted_at),
      });
    }
  }
  for (const item of overview?.external_import_quarantine?.items || []) {
    const metrics = runtimeRecord(item.candidate_metrics);
    const itemId = runtimeString(item.id);
    const jobId = runtimeString(item.source_mining_job_id) ||
      runtimeString(metrics.external_import_job_id) ||
      (itemId.startsWith('extimp_') ? itemId : '');
    if (jobId) {
      snapshots.push({
        jobId,
        updatedAt: runtimeTime(item.updated_at, item.published_at, item.created_at),
      });
    }
  }
  snapshots.sort((left, right) => right.updatedAt - left.updatedAt);
  const seen = new Set<string>();
  const jobIds: string[] = [];
  for (const snapshot of snapshots) {
    if (seen.has(snapshot.jobId)) {
      continue;
    }
    seen.add(snapshot.jobId);
    jobIds.push(snapshot.jobId);
    if (jobIds.length >= limit) {
      break;
    }
  }
  return jobIds;
}

function mapExternalFactorRegistry(
  registry: ApiExternalFactorSourceRegistryResponse,
): Partial<PublicFactorImportViewModel> {
  const frenchSource = findPublicFactorSource(registry, 'fama', 'french');
  const aqrSource = findPublicFactorSource(registry, 'aqr');
  const vibeSource = findPublicFactorSource(registry, 'vibe', 'alpha', 'zoo');
  const msciSource = findPublicFactorSource(registry, 'msci');
  const portfolioSource = findPublicFactorSource(registry, 'portfolio', 'visualizer');
  const sources: PublicFactorImportViewModel['sources'] = [
    {
      id: frenchSource?.id || 'french',
      name: 'French-Data Library',
      category: '学术基准',
      kind: publicFactorSourceKind(frenchSource?.access_policy || 'PUBLIC_DOWNLOAD'),
      tone: publicFactorSourceTone(frenchSource?.access_policy || 'PUBLIC_DOWNLOAD'),
      frequency: '日频 / 月频',
      badges: ['可自动导入'],
      description: 'FF3、FF5、Momentum，默认进入估值、质量与基准模板。',
    },
    {
      id: aqrSource?.id || 'aqr',
      name: 'AQR Data Library',
      category: '许可待确认',
      kind: publicFactorSourceKind(aqrSource?.access_policy || 'LICENSE_REQUIRED'),
      tone: publicFactorSourceTone(aqrSource?.access_policy || 'LICENSE_REQUIRED'),
      frequency: '日频 / 月频',
      badges: aqrSource?.supported_import_modes?.includes('AUTO_DOWNLOAD') ? ['可拉取源文件', '日频 / 月频'] : ['手动上传'],
      description: 'QMJ 与 TSMOM 先作为风险调整与动量参数模板。',
    },
    {
      id: vibeSource?.id || 'vibe_alpha_zoo',
      name: 'Vibe Alpha Zoo',
      category: '公式目录',
      kind: publicFactorSourceKind(vibeSource?.access_policy || 'PUBLIC_DOWNLOAD'),
      tone: publicFactorSourceTone(vibeSource?.access_policy || 'PUBLIC_DOWNLOAD'),
      frequency: '452 alpha catalog',
      badges: ['Raw_F2 only', 'AST scan', 'IC bench'],
      description: 'HKUDS/Vibe-Trading 公式目录只暂存为 Raw_F2，后续必须经过 WNZT 与 D2 检疫。',
    },
    {
      id: msciSource?.id || 'msci',
      name: 'MSCI FaCS',
      category: '参考源',
      kind: 'reference',
      tone: 'reference',
      frequency: '行业暴露',
      badges: ['人工参考'],
      description: '用于 max_cap 与行业暴露上限，不生成自动下载作业。',
    },
    {
      id: portfolioSource?.id || 'portfolio_visualizer',
      name: 'Portfolio Visualizer',
      category: '参考源',
      kind: 'reference',
      tone: 'reference',
      frequency: 'Factor Regression',
      badges: ['参数参考'],
      description: '用于风格表现观察，模板生成需人工填写来源证据。',
    },
  ];
  const datasets: PublicFactorImportViewModel['datasets'] = [
    {
      id: publicFactorDatasetId(frenchSource, 0, 'ff5-daily'),
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
      id: publicFactorDatasetId(frenchSource, 1, 'mom-daily'),
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
      id: publicFactorDatasetId(aqrSource, 0, 'aqr-qmj'),
      name: 'AQR QMJ Daily',
      key: 'aqr_us_qmj_daily',
      sourceName: 'AQR',
      frequency: '日频',
      coverage: '许可待核',
      status: 'review',
      fieldCount: 4,
      statusLabel: '需许可确认',
      actionLabel: '送入复核',
    },
    {
      id: publicFactorDatasetId(aqrSource, 1, 'aqr-tsmom'),
      name: 'AQR TSMOM Monthly',
      key: 'aqr_tsmom_monthly',
      sourceName: 'AQR',
      frequency: '月频',
      coverage: '许可待核',
      status: 'reference',
      fieldCount: 3,
      statusLabel: '手动上传',
      actionLabel: '重新解析',
    },
    {
      id: publicFactorDatasetId(vibeSource, 0, 'vibe-qlib158'),
      name: 'Vibe Qlib158 Alpha Zoo',
      key: 'vibe_qlib158',
      sourceName: 'Vibe',
      frequency: '公式目录',
      coverage: '158 formulas',
      status: 'review',
      fieldCount: 158,
      statusLabel: 'Raw_F2 候选',
      actionLabel: '解析目录',
    },
    {
      id: publicFactorDatasetId(vibeSource, 1, 'vibe-alpha101'),
      name: 'Vibe Alpha101',
      key: 'vibe_alpha101',
      sourceName: 'Vibe',
      frequency: '公式目录',
      coverage: '101 formulas',
      status: 'review',
      fieldCount: 101,
      statusLabel: 'Raw_F2 候选',
      actionLabel: '解析目录',
    },
    {
      id: publicFactorDatasetId(vibeSource, 2, 'vibe-gtja191'),
      name: 'Vibe GTJA191',
      key: 'vibe_gtja191',
      sourceName: 'Vibe',
      frequency: '公式目录',
      coverage: '191 formulas',
      status: 'review',
      fieldCount: 191,
      statusLabel: 'Raw_F2 候选',
      actionLabel: '解析目录',
    },
    {
      id: publicFactorDatasetId(vibeSource, 3, 'vibe-academic'),
      name: 'Vibe Academic Zoo',
      key: 'vibe_academic',
      sourceName: 'Vibe',
      frequency: '公式目录',
      coverage: '2 formula families',
      status: 'review',
      fieldCount: 2,
      statusLabel: 'Raw_F2 候选',
      actionLabel: '解析目录',
    },
  ];
  return {
    sources,
    datasets,
    activeSourceId: sources[0]?.id,
    activeDatasetId: datasets[0]?.id,
    updatedAtLabel: `${registry.template_version} · ${registry.review_boundary}`,
    manifest: {
      jobId: '',
      sourceName: '待选择公开源',
      datasetKey: '待创建预检',
      asOfDate: '',
      parserVersion: registry.template_version,
      rawFileHash: '等待文件 hash',
      rowCount: 0,
      artifactPath: '请先新建预检或导入本地文件',
      reviewNote: '先生成真实导入作业，再进入语义映射、manifest 确认与复核提交。',
      reviewStatus: 'NOT_STARTED',
      nextActions: ['create_precheck', 'semantic_mapping', 'inspect_manifest'],
      submitReady: false,
    },
  };
}

function mapExternalFactorJob(job: ApiExternalFactorImportJob): Partial<PublicFactorImportViewModel> {
  const hash = job.manifest?.file_sha256 ? `sha256:${job.manifest.file_sha256.slice(0, 12)}` : '等待文件 hash';
  const mappingRows = Array.isArray(job.mapping_rows) ? job.mapping_rows : [];
  const nextActions = Array.isArray(job.next_actions) ? job.next_actions : [];
  const reviewStatus = String(job.review_status || '');
  const rowCount = Number(job.manifest?.row_count ?? 0);
  const catalogManifest = runtimeRecord(job.manifest?.catalog_manifest);
  const astScan = runtimeRecord(catalogManifest.ast_scan);
  const benchSummary = runtimeRecord(job.manifest?.bench_summary);
  const rawF2Batch = runtimeRecord(job.raw_f2_batch || job.manifest?.raw_f2_batch);
  const rawF2FormulaCount = runtimeNumber(rawF2Batch.raw_f2_count, runtimeNumber(rawF2Batch.candidate_count, 0));
  const hasMaterializedFile = rowCount > 0 && Boolean(
    job.artifact_paths?.uploaded_file_id ||
    job.artifact_paths?.raw_file_ref ||
    job.artifact_paths?.download_url
  );
  const mappings: PublicFactorImportViewModel['mappings'] = mappingRows.map((row) => ({
    externalColumn: row.source_field || row.target_field,
    fullName: row.target_field || row.source_field,
    family: row.semantic_role || '语义字段',
    usage: `${row.transform || 'identity'} · ${row.data_type || 'string'}`,
    tags: [
      row.required ? '必填' : '可选',
      row.confidence >= 0.8 ? '高置信' : '需复核',
    ],
  }));
  const manifest: PublicFactorImportViewModel['manifest'] = {
    jobId: job.id,
    sourceName: job.source_name || job.source_id,
    datasetKey: job.dataset_key,
    asOfDate: job.as_of_date || job.updated_at || job.created_at,
    parserVersion: job.manifest?.template_key || 'public_us_factor_template_v1',
    rawFileHash: hash,
    rowCount,
    artifactPath: job.artifact_paths?.manifest_ref || job.artifact_paths?.raw_file_ref || '等待 manifest',
    reviewNote: externalImportReviewNoteLabel(reviewStatus, job.governance_gate, nextActions),
    reviewStatus,
    nextActions,
    submitReady: reviewStatus === 'READY_FOR_REVIEW' && nextActions.includes('submit_review') && (
      hasMaterializedFile || runtimeNumber(catalogManifest.supported_formula_count, 0) > 0
    ),
    catalogFormulaCount: runtimeNumber(catalogManifest.formula_count, rowCount),
    astPassedCount: runtimeNumber(astScan.passed_count, runtimeNumber(catalogManifest.supported_formula_count, 0)),
    astBlockedCount: runtimeNumber(astScan.blocked_count, runtimeNumber(catalogManifest.blocked_formula_count, 0)),
    benchAliveCount: runtimeNumber(benchSummary.alive_count, 0),
    benchReversedCount: runtimeNumber(benchSummary.reversed_count, 0),
    benchDeadCount: runtimeNumber(benchSummary.dead_count, 0),
    rawF2BatchId: runtimeString(rawF2Batch.batch_id || rawF2Batch.run_id),
    rawF2MiningJobId: runtimeString(rawF2Batch.mining_job_id || rawF2Batch.job_id),
    rawF2FormulaCount,
    flowNote: (job.source_id === 'vibe_alpha_zoo' || rawF2FormulaCount > 0)
      ? 'Catalog -> AST -> IC bench -> Raw_F2 -> WNZT -> Refined_F2 -> D2'
      : undefined,
    factorStatus: rawF2FormulaCount > 0 ? 'Raw_F2 staged; WNZT required before D2 quarantine' : undefined,
  };
  return {
    activeSourceId: job.source_id,
    activeDatasetId: job.dataset_key,
    mappings,
    mappingsByDataset: { [job.dataset_key]: mappings },
    manifest,
    manifestsByDataset: { [job.dataset_key]: manifest },
  };
}

function externalImportReviewStatusLabel(status: string): string {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'PENDING_REVIEW') return '待复核';
  if (normalized === 'NEEDS_MAPPING') return '需补齐语义映射';
  if (normalized === 'READY_FOR_REVIEW') return '可送复核';
  if (normalized === 'SUBMITTED') return '已送检';
  if (normalized === 'BLOCKED') return '已阻断';
  if (normalized === 'NOT_STARTED') return '未开始';
  return status || '待确认';
}

function externalImportGovernanceGateLabel(gate: string): string {
  const normalized = String(gate || '').toUpperCase();
  if (normalized === 'REVIEW_BEFORE_QUARANTINE') return '送检前复核';
  if (normalized === 'D2_QUARANTINE_REVIEW') return 'D2 检疫复核';
  if (normalized === 'RAW_F2_BEFORE_D2_QUARANTINE') return 'Raw_F2 先过 WNZT';
  return gate || '复核链路';
}

function externalImportNextActionLabel(action: string): string {
  const normalized = String(action || '').toLowerCase();
  if (normalized === 'upload_source_file') return '拉取或上传源文件';
  if (normalized === 'inspect_manifest') return '查看 manifest';
  if (normalized === 'submit_review') return '送入复核';
  if (normalized === 'complete_semantic_mapping') return '补齐语义映射';
  if (normalized === 'b3_quarantine_intake') return '进入 B3 检疫';
  if (normalized === 'b3_quarantine_run') return '运行 B3 检疫';
  if (normalized === 'b3_quarantine_completed') return 'B3 检疫完成';
  if (normalized === 'stage_raw_f2') return '暂存 Raw_F2';
  if (normalized === 'raw_f2_batch_created') return 'Raw_F2 批次已创建';
  if (normalized === 'wnzt_refinement_required') return '等待 WNZT 精炼';
  return action || '待处理';
}

function externalImportReviewNoteLabel(status: string, gate: string, actions: string[]): string {
  const actionLabel = actions.length
    ? actions.map(externalImportNextActionLabel).join(' / ')
    : '等待下一步';
  return `${externalImportReviewStatusLabel(status)} · ${externalImportGovernanceGateLabel(gate)} · ${actionLabel}`;
}

function externalImportPublishStatusLabel(status: string): string {
  const normalized = String(status || '').toUpperCase();
  if (normalized === 'PUBLISHED') return '已发布到因子库';
  if (normalized === 'ELIGIBLE') return '可发布候选';
  if (normalized === 'PASSED') return '检疫通过';
  if (normalized === 'REJECTED') return '已拒绝';
  if (normalized === 'FAILED') return '检疫失败';
  return status || '待确认';
}

function externalImportQuarantineResultLabel(result: string): string {
  const normalized = String(result || '').toUpperCase();
  if (normalized === 'PASS') return 'B3 检疫通过';
  if (normalized === 'WARN') return 'B3 需复核';
  if (normalized === 'FAIL') return 'B3 检疫失败';
  return result || '待确认';
}

function externalImportFactorStatusLabel(publishStatus: string, quarantineResult: string): string {
  const normalizedPublish = String(publishStatus || '').toUpperCase();
  if (normalizedPublish === 'PUBLISHED') return '已发布到正式因子库';
  if (normalizedPublish === 'ELIGIBLE') return 'B3 通过，待发布准入';
  const normalizedQuarantine = String(quarantineResult || '').toUpperCase();
  if (normalizedQuarantine === 'PASS') return 'B3 检疫通过';
  if (normalizedQuarantine === 'WARN') return 'B3 需人工复核';
  if (normalizedQuarantine === 'FAIL') return 'B3 检疫失败';
  return publishStatus || quarantineResult || '待确认';
}

function externalImportAuditByJobId(
  overview: ApiFactorFactoryOverview | null | undefined,
): Map<string, Partial<PublicFactorImportManifest>> {
  const audits = new Map<string, Partial<PublicFactorImportManifest>>();
  for (const item of overview?.external_import_quarantine?.items || []) {
    const record = runtimeRecord(item);
    const metrics = runtimeRecord(record.candidate_metrics);
    const itemId = runtimeString(record.id);
    const jobId = runtimeString(record.source_mining_job_id) ||
      runtimeString(metrics.external_import_job_id) ||
      (itemId.startsWith('extimp_') ? itemId : '');
    if (!jobId) {
      continue;
    }
    const publishStatus = runtimeString(record.publish_status) || runtimeString(record.status);
    const quarantineResult = runtimeString(record.quarantine_result);
    const publishStatusLabel = externalImportPublishStatusLabel(publishStatus);
    const quarantineResultLabel = externalImportQuarantineResultLabel(quarantineResult);
    const factorName =
      runtimeString(record.display_name_cn) ||
      runtimeString(record.factor_name) ||
      runtimeString(metrics.external_import_display_name) ||
      runtimeString(record.target_factor_id);
    audits.set(jobId, {
      reviewOutcome: `${quarantineResultLabel} · ${publishStatusLabel}`,
      quarantineResult: quarantineResultLabel,
      publishStatus: publishStatusLabel,
      factorStatus: externalImportFactorStatusLabel(publishStatus, quarantineResult),
      factorName,
      quarantineCandidateId: itemId,
      targetFactorId: runtimeString(record.target_factor_id),
    });
  }
  return audits;
}

export function isRouteChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS/i.test(message);
}

export function buildRouteChunkReloadUrl(locationLike: Pick<Location, 'href'> | URL, timestamp = Date.now()): string {
  const url = new URL(locationLike.href);
  url.searchParams.set('v', `route-reload-${timestamp}`);
  return url.toString();
}

function routeChunkReloadKey(): string {
  return `${ROUTE_CHUNK_RELOAD_PREFIX}:${window.location.pathname}:${window.location.hash || '#/workspace'}`;
}

function reloadRouteDocumentOnce(error: unknown): boolean {
  if (!isRouteChunkLoadError(error)) return false;
  const key = routeChunkReloadKey();
  if (window.sessionStorage.getItem(key) === '1') return false;
  window.sessionStorage.setItem(key, '1');
  window.location.replace(buildRouteChunkReloadUrl(window.location));
  return true;
}

// Keep the shell light: each route downloads only the page module it renders.
const BacktestSubmitPage = lazy(() =>
  import('./pages/backtest-submit-page-cn').then((module) => ({ default: module.BacktestSubmitPage })),
);
const CompositionAllocationConfigPage = lazy(() =>
  import('./pages/composition-allocation-page').then((module) => ({ default: module.CompositionAllocationConfigPage })),
);
const CompositionAllocationResultPage = lazy(() =>
  import('./pages/composition-allocation-page').then((module) => ({ default: module.CompositionAllocationResultPage })),
);
const CompositionBacktestConfigPage = lazy(() =>
  import('./pages/composition-backtest-config-page').then((module) => ({ default: module.CompositionBacktestConfigPage })),
);
const CompositionBacktestResultPage = lazy(() =>
  import('./pages/composition-backtest-result-page').then((module) => ({ default: module.CompositionBacktestResultPage })),
);
const CompositionDashboardPage = lazy(() =>
  import('./pages/composition-dashboard-page').then((module) => ({ default: module.CompositionDashboardPage })),
);
const CompositionDetailPage = lazy(() =>
  import('./pages/composition-detail-page').then((module) => ({ default: module.CompositionDetailPage })),
);
const CompositionBacktestRunsIndexPage = lazy(() =>
  import('./pages/composition-global-index-page').then((module) => ({ default: module.CompositionBacktestRunsIndexPage })),
);
const CompositionLabIndexPage = lazy(() =>
  import('./pages/composition-global-index-page').then((module) => ({ default: module.CompositionLabIndexPage })),
);
const CompositionListIndexPage = lazy(() =>
  import('./pages/composition-global-index-page').then((module) => ({ default: module.CompositionListIndexPage })),
);
const CompositionWorkbenchPage = lazy(() =>
  import('./pages/composition-workbench-page').then((module) => ({ default: module.CompositionWorkbenchPage })),
);
const AssetAllocationConfigPage = lazy(() =>
  import('./pages/asset-allocation-config-page').then((module) => ({ default: module.AssetAllocationConfigPage })),
);
const CreationSessionPage = lazy(() =>
  import('./pages/creation-session-page').then((module) => ({ default: module.CreationSessionPage })),
);
const FactorDetailPage = lazy(() =>
  import('./pages/factors-page').then((module) => ({ default: module.FactorDetailPage })),
);
const FactorEditorPage = lazy(() =>
  import('./pages/factors-page').then((module) => ({ default: module.FactorEditorPage })),
);
const FactorLibraryPage = lazy(() =>
  import('./pages/factors-page').then((module) => ({ default: module.FactorLibraryPage })),
);
const PitCleaningCenterPage = lazy(() =>
  import('./pages/factors-page').then((module) => ({ default: module.PitCleaningCenterPage })),
);
const FactorFactoryPage = lazy(() => import('./pages/factor-factory-page'));
const FactorSandboxPage = lazy(() => import('./pages/factor-sandbox-page'));
const FactorQuarantinePage = lazy(() => import('./pages/factor-quarantine-page'));
const FactorModelBuilderPage = lazy(() => import('./pages/factor-model-builder-page'));
const PublicFactorImportCenterPage = lazy(() => import('./pages/public-factor-import-center-page'));
const LegInventoryPage = lazy(() =>
  import('./pages/leg-inventory-page').then((module) => ({ default: module.LegInventoryPage })),
);
const OptimizationConfigPage = lazy(() =>
  import('./pages/optimization-lab-page').then((module) => ({ default: module.OptimizationConfigPage })),
);
const OptimizationJobsIndexPage = lazy(() =>
  import('./pages/optimization-lab-page').then((module) => ({ default: module.OptimizationJobsIndexPage })),
);
const OptimizationResultsPage = lazy(() =>
  import('./pages/optimization-lab-page').then((module) => ({ default: module.OptimizationResultsPage })),
);
const OptimizationStrategySelectPage = lazy(() =>
  import('./pages/optimization-lab-page').then((module) => ({ default: module.OptimizationStrategySelectPage })),
);
const RunDetailPage = lazy(() =>
  import('./pages/run-detail-page').then((module) => ({ default: module.RunDetailPage })),
);
const RunsIndexPage = lazy(() =>
  import('./pages/runs-index-page').then((module) => ({ default: module.RunsIndexPage })),
);
const SnapshotsPage = lazy(() =>
  import('./pages/snapshots-page').then((module) => ({ default: module.SnapshotsPage })),
);
const StrategyDetailPage = lazy(() =>
  import('./pages/strategy-detail-page').then((module) => ({ default: module.StrategyDetailPage })),
);
const WorkspacePage = lazy(() =>
  import('./pages/workspace-page-lane-b').then((module) => ({ default: module.WorkspacePage })),
);

function miningCandidateFamily(candidate: RuntimeMiningCandidate, index: number): string {
  const expression = String(candidate.expression ?? '');
  if (/Std|Vol/i.test(expression)) return `低波候选 #${index + 1}`;
  if (/Return|Momentum|Lag/i.test(expression)) return `动量候选 #${index + 1}`;
  if (/Log|Rank|ZScore|Winsorize/i.test(expression)) return `转换候选 #${index + 1}`;
  return `候选 #${index + 1}`;
}

function mapApiMiningCandidate(
  candidate: RuntimeMiningCandidate,
  index: number,
  sourceJobId?: string,
): FactorMiningCandidate {
  return {
    id: String(candidate.id ?? `candidate-${index + 1}`),
    expression: String(candidate.expression ?? ''),
    family: miningCandidateFamily(candidate, index),
    rankIc: Number(candidate.rank_ic ?? candidate.score ?? 0),
    coveragePct: Number(candidate.coverage ?? 0) * 100,
    turnoverPct: Number(candidate.turnover ?? 0) * 100,
    riskFlags: Array.isArray(candidate.risk_flags) ? candidate.risk_flags.map(String) : [],
    sourceJobId,
  };
}

function mapApiMiningJob(job: RuntimeMiningJob): FactorMiningJob {
  const request = job.request ?? {};
  const progress = job.progress ?? {};
  const topCandidates = job.top_candidates ?? [];
  const topRankIc = topCandidates.reduce((best, candidate) => Math.max(best, Math.abs(Number(candidate.rank_ic ?? 0))), 0);
  return {
    id: job.id,
    name: `${String(request.universe ?? 'SP500')} 因子挖掘`,
    status: job.status,
    universe: String(request.universe ?? 'SP500'),
    dateRange: `${String(request.start_date ?? '')} 至 ${String(request.end_date ?? '')}`,
    operators: Array.isArray(request.operators) ? request.operators.map(String) : [],
    candidateCount: Number(progress.total_candidates ?? request.candidate_count ?? 0),
    startDate: String(request.start_date ?? ''),
    endDate: String(request.end_date ?? ''),
    progressPct: Number(progress.percent ?? 0),
    throughputPerMinute: Number(progress.throughput_per_second ?? 0) * 60,
    failedSampleCount: Number(progress.failed_candidates ?? job.failed_samples?.length ?? 0),
    topRankIc,
    createdAt: job.created_at,
    randomSeed: request.random_seed ?? null,
    minRankIc: Number(request.min_rank_ic ?? 0),
    maxDepth: Number(request.max_depth ?? 0),
    topCandidates: topCandidates.map((candidate, index) => mapApiMiningCandidate(candidate, index, job.id)),
  };
}

function mapDirectionToModel(direction: ApiFactorDirection): 'HIGH_IS_GOOD' | 'LOW_IS_GOOD' {
  return direction === 'LOW_IS_BETTER' ? 'LOW_IS_GOOD' : 'HIGH_IS_GOOD';
}

function mapDirectionToApi(direction: 'HIGH_IS_GOOD' | 'LOW_IS_GOOD'): ApiFactorDirection {
  return direction === 'LOW_IS_GOOD' ? 'LOW_IS_BETTER' : 'HIGH_IS_BETTER';
}

function factorCategoryLabel(factor: ApiFactorListItem): string {
  const family = String(factor.factor_family ?? '').trim();
  if (family) return family;
  const category = String(factor.descriptor?.category ?? '').trim();
  return FACTOR_CATEGORY_LABELS[category] ?? (category || '自定义');
}

function factorMetricLabel(label: string, value: unknown, digits: number): string {
  if (value === null || value === undefined || value === '') return `${label} 待诊断`;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return `${label} 待诊断`;
  return `${label} ${numeric.toFixed(digits)}`;
}

function factorMetricValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function factorDiagnosticSummary(factor: ApiFactorListItem): { rank_ic?: unknown; ir?: unknown; status?: unknown } {
  return factor.latest_diagnostic_summary ?? factor.batch_diagnostic_summary ?? {};
}

function factorHasMetricData(factor: ApiFactorListItem): boolean {
  const summary = factorDiagnosticSummary(factor);
  return factorMetricValue(summary.rank_ic) !== null && factorMetricValue(summary.ir) !== null;
}

function factorNeedsDiagnosticPreview(factor: ApiFactorListItem): boolean {
  if (factorHasMetricData(factor)) return false;
  const summary = factor.latest_diagnostic_summary;
  const status = String(summary?.status ?? '').trim().toUpperCase();
  const lineage = summary?.data_lineage as Record<string, unknown> | undefined;
  const lineageKind = String(lineage?.kind ?? '').trim().toUpperCase();
  return lineageKind !== 'FACTOR_EXPRESSION_PREVIEW' && status !== 'PREVIEW';
}

function previewRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function mergeFactorDiagnosticPreview(
  factors: ApiFactorListItem[],
  preview: ApiFactorDiagnosticPreview,
): ApiFactorListItem[] {
  const previewItems = new Map<string, Record<string, unknown>>();
  (preview.items ?? []).forEach((item) => {
    const record = previewRecord(item);
    const factorId = typeof record?.factor_id === 'string' ? record.factor_id : null;
    if (factorId && record) previewItems.set(factorId, record);
  });
  if (!previewItems.size) return factors;
  return factors.map((factor) => {
    const record = previewItems.get(factor.id);
    if (!record) return factor;
    const latest = previewRecord(record.latest_diagnostic_summary);
    const batch = previewRecord(record.batch_diagnostic_summary);
    return {
      ...factor,
      ui_state: typeof record.ui_state === 'string' ? record.ui_state as ApiFactorListItem['ui_state'] : factor.ui_state,
      ui_state_label: typeof record.ui_state_label === 'string' ? record.ui_state_label : factor.ui_state_label,
      diagnostic_status: typeof record.diagnostic_status === 'string'
        ? record.diagnostic_status as ApiFactorListItem['diagnostic_status']
        : factor.diagnostic_status,
      latest_diagnostic_summary: latest
        ? { ...(factor.latest_diagnostic_summary ?? {}), ...latest } as ApiFactorListItem['latest_diagnostic_summary']
        : factor.latest_diagnostic_summary,
      batch_diagnostic_summary: batch
        ? { ...(factor.batch_diagnostic_summary ?? {}), ...batch } as ApiFactorListItem['batch_diagnostic_summary']
        : factor.batch_diagnostic_summary,
    };
  });
}

async function previewFactorDiagnosticsForModelOptions(
  api: ApiClient,
  factorIds: string[],
): Promise<ApiFactorDiagnosticPreview | null> {
  const request = {
    batch: true,
    factor_ids: factorIds,
    diagnostic_mode: 'SANDBOX' as const,
    include: ['ic', 'ir', 'groups', 'turnover', 'correlation', 'blockers'],
  };
  try {
    return await api.previewFactorDiagnostics(request);
  } catch {
    const items: NonNullable<ApiFactorDiagnosticPreview['items']> = [];
    for (const factorId of factorIds) {
      try {
        const preview = await api.previewFactorDiagnostics({ ...request, factor_ids: [factorId] });
        items.push(...(preview.items ?? []));
      } catch {
        // A single unsupported expression should not hide the rest of the model-builder basket.
      }
    }
    return items.length ? { mode: 'BATCH', status: 'PREVIEW', items } : null;
  }
}

function isOnlineFactorModelCandidate(factor: ApiFactorListItem): boolean {
  const lifecycle = String(factor.lifecycle_status ?? '').trim().toUpperCase();
  const diagnostic = String(factor.latest_diagnostic_summary?.status ?? factor.diagnostic_status ?? '').trim().toUpperCase();
  const uiState = String(factor.ui_state ?? '').trim().toLowerCase();
  return (
    lifecycle !== 'DEPRECATED' &&
    lifecycle !== 'PRUNED' &&
    lifecycle !== 'DECAYED' &&
    !factor.offline_at &&
    diagnostic !== 'FAILED' &&
    uiState !== 'decayed'
  );
}

function mapFactorOption(factor: ApiFactorListItem): FactorModelOption {
  const pitCoverage = factor.pit_coverage as { missing_fields?: unknown[]; required_fields?: unknown[] } | undefined;
  const requiredCount = Array.isArray(pitCoverage?.required_fields) ? pitCoverage.required_fields.length : 0;
  const missingCount = Array.isArray(pitCoverage?.missing_fields) ? pitCoverage.missing_fields.length : 0;
  const coveragePct = requiredCount > 0 ? Math.max(0, 100 - (missingCount / requiredCount) * 100) : 100;
  const factorRecord = factor as ApiFactorListItem & {
    default_model_weight?: unknown;
    default_weight?: unknown;
    suggested_model_weight?: unknown;
  };
  const suggestedWeight = Number(
    factorRecord.default_model_weight ?? factorRecord.suggested_model_weight ?? factorRecord.default_weight ?? 0,
  );
  const diagnosticSummary = factorDiagnosticSummary(factor);
  const categoryLabel = factorCategoryLabel(factor);
  const rankIc = factorMetricValue(diagnosticSummary.rank_ic);
  const ir = factorMetricValue(diagnosticSummary.ir);
  const opCompleted = Array.isArray(factor.op_status?.completed)
    ? factor.op_status.completed.map(String)
    : [];
  return {
    id: factor.id,
    displayName: formatFactorDisplayName(factor.id, factor.display_name_cn ?? factor.name),
    family: categoryLabel,
    categoryLabel,
    market: factor.market ?? null,
    tierLevel: factor.tier_level ?? factor.tier_projection?.key ?? null,
    factorLevel: factor.factor_level ?? factor.factor_level_projection?.key ?? null,
    factorLevelLabel: factor.factor_level_label ?? factor.factor_level_projection?.label ?? undefined,
    opCompleted,
    rankIc,
    ir,
    rankIcLabel: factorMetricLabel('Rank IC', rankIc, 3),
    irLabel: factorMetricLabel('IR', ir, 2),
    sourceLabel: factor.source === 'SYSTEM_SEED' ? '系统默认' : factor.source === 'AUTO_MINED' ? '自动挖掘' : '人工',
    diagnosticStatus: String(diagnosticSummary.status ?? factor.diagnostic_status ?? ''),
    lifecycleStatus: factor.lifecycle_status,
    uiState: factor.ui_state ?? null,
    uiStateLabel: factor.ui_state_label ?? null,
    isOnline: isOnlineFactorModelCandidate(factor),
    pitCoveragePct: coveragePct,
    defaultWeight: Number.isFinite(suggestedWeight) ? suggestedWeight : 0,
    defaultDirection: mapDirectionToModel(factor.direction),
  };
}

export async function loadFactorModelOptions(api: ApiClient): Promise<FactorModelOption[]> {
  const response = await api.listFactors({ lifecycle: 'online' });
  let candidates = response.items.filter(isOnlineFactorModelCandidate);
  const previewFactorIds = candidates.filter(factorNeedsDiagnosticPreview).map((factor) => factor.id);
  if (previewFactorIds.length) {
    const preview = await previewFactorDiagnosticsForModelOptions(api, previewFactorIds);
    if (preview) {
      candidates = mergeFactorDiagnosticPreview(candidates, preview);
    }
  }
  return candidates
    .filter(isOnlineFactorModelCandidate)
    .filter(factorHasMetricData)
    .map(mapFactorOption);
}

function mapModelPayload(payload: FactorModelPreviewPayload) {
  return {
    strategy_type: payload.strategyType ?? 'MULTI_FACTOR',
    name: payload.modelName,
    universe: 'SP500',
    rebalance_frequency: payload.rebalanceFrequency,
    top_n: payload.topN,
    scoring_method: 'zscore_weighted',
    components: payload.factors.map((factor) => ({
      factor_id: factor.factorId,
      weight: factor.weightPct,
      direction: mapDirectionToApi(factor.direction),
    })),
    neutralization: {
      enabled: payload.neutralization.enabled,
      method: 'industry',
    },
    universe_filter: payload.universeFilter ? {
      min_adv_usd: payload.universeFilter.minAdvUsd,
      adv_window: payload.universeFilter.advWindow,
      exclude_halted: payload.universeFilter.excludeHalted,
      exclude_otc_pink: payload.universeFilter.excludeOtcPink,
      exclude_luld_paused: payload.universeFilter.excludeLuldPaused,
      delisting_window_days: payload.universeFilter.delistingWindowDays,
      sector_overrides: payload.universeFilter.sectorOverrides,
    } : undefined,
    weight_mapping: payload.weightMapping ? {
      method: payload.weightMapping.method,
      top_n: payload.topN,
      sector_cap_pct: payload.weightMapping.sectorCapPct,
      max_position_pct: payload.weightMapping.maxPositionPct,
      min_target_weight_pct: payload.weightMapping.minTargetWeightPct,
      cap_redistribution_mode: payload.weightMapping.capRedistributionMode,
    } : undefined,
    rebalance_logic: payload.rebalanceLogic ? {
      frequency: payload.rebalanceLogic.frequency,
      calendar_rule: payload.rebalanceLogic.calendarRule,
      exit_rank_percentile: payload.rebalanceLogic.exitRankPercentile,
      min_trade_notional_usd: payload.rebalanceLogic.minTradeNotionalUsd,
    } : undefined,
    execution_constraints: payload.executionConstraints ? {
      notional_usd: payload.executionConstraints.notionalUsd,
      commission_bps: payload.executionConstraints.commissionBps,
      stamp_tax_bps: payload.executionConstraints.stampTaxBps,
      base_slippage_bps: payload.executionConstraints.baseSlippageBps,
      impact_beta: payload.executionConstraints.impactBeta,
      max_impact_bps: payload.executionConstraints.maxImpactBps,
    } : undefined,
  };
}

function mapModelPreview(response: Awaited<ReturnType<ApiClient['previewFactorModel']>>): FactorModelPreview {
  const coverage = response.coverage ?? {};
  const estimatedCoverage = Number(coverage.estimated_factor_coverage ?? 0);
  const normalizedWeights = response.normalized_weights.map((item) => ({
    factorId: String(item.factor_id),
    weightPct: Number(item.weight ?? 0),
    normalizedWeightPct: Math.abs(Number(item.normalized_weight ?? 0)) * 100,
    direction: mapDirectionToModel(item.direction),
    diagnosticStatus: String(item.diagnostic_status ?? ''),
  }));
  const scorePreview = response.score_preview.map((item) => {
    const coveragePct = Number(item.coverage ?? 0);
    return {
      symbol: String(item.symbol ?? ''),
      score: Number(item.score ?? 0),
      coveragePct: coveragePct > 1 ? coveragePct : coveragePct * 100,
    };
  });
  const scores = scorePreview.map((item) => item.score);
  const spread = scores.length ? Math.max(...scores) - Math.min(...scores) : 0;
  const neutralization = response.neutralization_status ?? {};
  const neutralizationBlockers = Array.isArray(neutralization.blockers) ? neutralization.blockers.map(String) : [];
  const neutralizationSourceNames = Array.isArray(neutralization.source_names)
    ? neutralization.source_names.map(String).filter(Boolean)
    : [];
  const estimatedTurnover = Number(response.estimated_turnover ?? 0);
  const strategyCreationRisk = response.strategy_creation_risk as FactorModelStrategyCreationRisk | undefined;
  const diagnosticSummary = (response.diagnostic_summary ?? strategyCreationRisk?.diagnostic_summary ?? null) as Record<string, unknown> | null;
  const sectorCapForecast = (response.sector_cap_forecast ?? strategyCreationRisk?.sector_cap_forecast ?? null) as Record<string, unknown> | null;
  const costForecast = (response.cost_forecast ?? strategyCreationRisk?.cost_forecast ?? null) as Record<string, unknown> | null;
  return {
    status: String(response.status ?? 'UNKNOWN'),
    coveragePct: estimatedCoverage > 1 ? estimatedCoverage : estimatedCoverage * 100,
    factorCount: Number(coverage.factor_count ?? normalizedWeights.length),
    readyFactorCount: Number(coverage.ready_factor_count ?? normalizedWeights.length),
    universeSymbolCount: Number(coverage.universe_symbol_count ?? scorePreview.length),
    turnoverPct: estimatedTurnover > 1 ? estimatedTurnover : estimatedTurnover * 100,
    scoreSpread: spread,
    scorePreview,
    normalizedWeights,
    pitBlockers: response.pit_blockers.map((item) => String(item.message ?? item.code ?? 'PIT blocker')),
    neutralizationStatus: {
      enabled: Boolean(neutralization.enabled),
      method: String(neutralization.method ?? 'industry'),
      status: String(neutralization.status ?? 'UNKNOWN'),
      blockers: neutralizationBlockers,
      industryField: typeof neutralization.industry_field === 'string' ? neutralization.industry_field : null,
      taxonomy: typeof neutralization.taxonomy === 'string' ? neutralization.taxonomy : null,
      coveredSymbolCount: Number.isFinite(Number(neutralization.covered_symbol_count))
        ? Number(neutralization.covered_symbol_count)
        : null,
      missingSymbolCount: Number.isFinite(Number(neutralization.missing_symbol_count))
        ? Number(neutralization.missing_symbol_count)
        : null,
      sourceNames: neutralizationSourceNames,
    },
    warnings: Array.isArray(response.warnings) ? response.warnings.map(String) : [],
    strategyCreationRisk,
    diagnosticSummary,
    sectorCapForecast,
    costForecast,
  };
}

function FactorSandboxRoutePage(): JSX.Element {
  const api = useApiClient();
  return (
    <FactorSandboxPage
      api={{
        listFactorMiningJobs: async () => {
          await new Promise((resolve) => window.setTimeout(resolve, FIRST_SCREEN_DEFER_MS));
          const payload = await api.listFactorMiningJobs();
          return payload.items.map(mapApiMiningJob);
        },
        createFactorMiningJob: async (payload: FactorMiningCreatePayload) =>
          mapApiMiningJob(
            await api.createFactorMiningJob({
              universe: payload.universe,
              start_date: payload.startDate,
              end_date: payload.endDate,
              operators: payload.operators,
              candidate_count: payload.candidateCount,
              random_seed: payload.randomSeed,
              min_rank_ic: payload.minRankIc,
              max_depth: payload.maxDepth,
            }),
          ),
        cancelFactorMiningJob: async (jobId: string) => mapApiMiningJob(await api.cancelFactorMiningJob(jobId)),
        intakeFactorQuarantine: async (payload) => {
          if (!api.factorQuarantineIntake) {
            throw new Error('检疫接收 API 尚未接入。');
          }
          const response = await api.factorQuarantineIntake({
            mining_job_id: payload.miningJobId,
            candidate_ids: payload.candidateIds,
          });
          return {
            intakeCount: Number(response?.summary?.intake_count ?? response?.items.length ?? 0),
            sourceMiningJobId: typeof response?.summary?.source_mining_job_id === 'string'
              ? response.summary.source_mining_job_id
              : null,
          };
        },
      }}
      onOpenPitGate={() => navigateTo('/pit-data?section=fundamental-requirements')}
    />
  );
}

function FactorModelBuilderRoutePage({ route }: { route: FactorModelBuilderRoute }): JSX.Element {
  const api = useApiClient();
  const [factors, setFactors] = useState<FactorModelOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      loadFactorModelOptions(api)
        .then((options) => {
          if (!cancelled) {
            setFactors(options);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFactors([]);
          }
        });
    }, FIRST_SCREEN_DEFER_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [api]);

  return (
    <FactorModelBuilderPage
      key={factors.length ? `live-factors-${factors.map((factor) => factor.id).join('|')}` : 'empty-live-factors'}
      api={{
        previewFactorModel: async (payload: FactorModelPreviewPayload) =>
          mapModelPreview(await api.previewFactorModel(mapModelPayload(payload))),
        createFactorModel: async (payload: FactorModelPreviewPayload): Promise<FactorModelCreateResponse> => {
          const strategy = await api.createFactorModel(mapModelPayload(payload));
          return {
            strategy_id: strategy.id,
            parameter_version_id: strategy.current_parameter_version_id ?? undefined,
          };
        },
      }}
      factors={factors}
      autoPreviewDelayMs={FIRST_SCREEN_DEFER_MS}
      initialPrefill={route.prefill}
      useDefaultFallback={false}
      defaultSelectAll={false}
      onCreated={(strategyId) => navigateTo(`/strategies/${strategyId}`)}
    />
  );
}

function PublicFactorImportRoutePage(): JSX.Element {
  const api = useApiClient();
  const importApi: PublicFactorImportApi = {
    loadViewModel: async () => {
      if (!api.getExternalFactorSourceRegistry) {
        return null;
      }
      const registryPatch = mapExternalFactorRegistry(await api.getExternalFactorSourceRegistry());
      if (!api.getFactorFactoryOverview || !api.getExternalFactorImportJob) {
        return registryPatch;
      }
      const getExternalFactorImportJob = api.getExternalFactorImportJob;
      try {
        const overview = await api.getFactorFactoryOverview();
        const auditByJobId = externalImportAuditByJobId(overview);
        const jobIds = externalImportJobIdsFromOverview(overview);
        if (!jobIds.length) {
          return registryPatch;
        }
        const jobPatches = (await Promise.all(jobIds.map(async (jobId) => {
          try {
            const job = await getExternalFactorImportJob(jobId);
            const patch = mapExternalFactorJob(job);
            const audit = auditByJobId.get(job.id);
            if (patch.manifest && audit) {
              patch.manifest = { ...patch.manifest, ...audit };
              patch.manifestsByDataset = {
                ...(patch.manifestsByDataset ?? {}),
                [patch.manifest.datasetKey]: patch.manifest,
              };
            }
            return patch;
          } catch {
            return null;
          }
        }))).filter(Boolean) as Array<Partial<PublicFactorImportViewModel>>;
        if (!jobPatches.length) {
          return registryPatch;
        }
        const latestJobPatch = jobPatches[0];
        const mappingsByDataset = { ...(registryPatch.mappingsByDataset ?? {}) };
        const manifestsByDataset = { ...(registryPatch.manifestsByDataset ?? {}) };
        for (const patch of jobPatches) {
          for (const [datasetKey, mappings] of Object.entries(patch.mappingsByDataset ?? {})) {
            if (!mappingsByDataset[datasetKey]) {
              mappingsByDataset[datasetKey] = mappings;
            }
          }
          for (const [datasetKey, manifest] of Object.entries(patch.manifestsByDataset ?? {})) {
            if (!manifestsByDataset[datasetKey]) {
              manifestsByDataset[datasetKey] = manifest;
            }
          }
          if (patch.activeDatasetId && patch.mappings?.length && !mappingsByDataset[patch.activeDatasetId]) {
            mappingsByDataset[patch.activeDatasetId] = patch.mappings;
          }
          if (patch.activeDatasetId && patch.manifest && !manifestsByDataset[patch.activeDatasetId]) {
            manifestsByDataset[patch.activeDatasetId] = patch.manifest;
          }
          if (patch.manifest?.datasetKey && !manifestsByDataset[patch.manifest.datasetKey]) {
            manifestsByDataset[patch.manifest.datasetKey] = patch.manifest;
          }
        }
        return {
          ...registryPatch,
          ...latestJobPatch,
          sources: registryPatch.sources,
          datasets: registryPatch.datasets,
          mappingsByDataset,
          manifestsByDataset,
          updatedAtLabel: registryPatch.updatedAtLabel,
        };
      } catch {
        return registryPatch;
      }
    },
    createPrecheck: async (payload) => {
      if (!api.createExternalFactorImportJob) {
        return null;
      }
      const sourceId = normalizePublicFactorSourceId(payload.sourceId);
      const datasetKey = normalizePublicFactorDatasetKey(payload.datasetId);
      const job = await api.createExternalFactorImportJob({
        source_id: sourceId,
        dataset_key: datasetKey,
        import_mode: (sourceId === 'fama_french' || datasetKey === 'aqr_public_style_factors') && payload.importMode === 'AUTO_DOWNLOAD'
          ? 'AUTO_DOWNLOAD'
          : 'SOURCE_MANIFEST',
        frequency: normalizePublicFactorFrequency(payload.frequency),
        created_by: 'researcher',
        precheck_notes: payload.note,
      });
      return mapExternalFactorJob(job);
    },
    importLocalFile: async (payload) => {
      if (!api.uploadExternalFactorLocalFile || !api.createExternalFactorImportJob) {
        return null;
      }
      const sourceId = normalizePublicFactorSourceId(payload.sourceId);
      const datasetKey = normalizePublicFactorDatasetKey(payload.datasetId);
      const file = payload.file;
      const upload = await api.uploadExternalFactorLocalFile({
        source_id: sourceId,
        dataset_key: datasetKey,
        filename: file?.name || 'manual_public_factor_upload.csv',
        content_text: file ? await file.text() : '',
        content_type: file?.type || 'text/csv',
      });
      const job = await api.createExternalFactorImportJob({
        source_id: sourceId,
        dataset_key: datasetKey,
        import_mode: 'LOCAL_FILE',
        file_id: upload.file_id,
        frequency: normalizePublicFactorFrequency(payload.frequency),
        created_by: 'researcher',
        precheck_notes: 'Created from local file import modal.',
      });
      return mapExternalFactorJob(job);
    },
    materializeSourceFile: async ({ jobId }) => {
      if (!api.materializeExternalFactorImportSourceFile) {
        return null;
      }
      return mapExternalFactorJob(await api.materializeExternalFactorImportSourceFile(jobId));
    },
    submitReview: async ({ jobId }) => {
      if (!api.submitExternalFactorImportReview) {
        return null;
      }
      return mapExternalFactorJob(await api.submitExternalFactorImportReview(jobId));
    },
  };
  return <PublicFactorImportCenterPage api={importApi} />;
}

function RouteLoadingFallback(): JSX.Element {
  return (
    <div className="route-loading-fallback" role="status">
      路由加载中...
    </div>
  );
}

function RouteErrorFallback({ error, reloading }: { error: unknown; reloading: boolean }): JSX.Element {
  return (
    <div className="route-loading-fallback route-loading-fallback--error" role="alert">
      {reloading || isRouteChunkLoadError(error)
        ? '正在刷新最新页面资源...'
        : '当前路由加载失败，请刷新页面后重试。'}
    </div>
  );
}

type RouteErrorBoundaryProps = {
  children: ReactNode;
  resetKey: string;
};

type RouteErrorBoundaryState = {
  error: unknown;
  reloading: boolean;
};

class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  override state: RouteErrorBoundaryState = {
    error: null,
    reloading: false,
  };

  static getDerivedStateFromError(error: unknown): Partial<RouteErrorBoundaryState> {
    return { error };
  }

  override componentDidCatch(error: unknown, _info: ErrorInfo): void {
    if (reloadRouteDocumentOnce(error)) {
      this.setState({ reloading: true });
    }
  }

  override componentDidUpdate(previousProps: RouteErrorBoundaryProps): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, reloading: false });
    }
  }

  override render(): ReactNode {
    if (this.state.error) {
      return <RouteErrorFallback error={this.state.error} reloading={this.state.reloading} />;
    }
    return this.props.children;
  }
}

function AppShell(): JSX.Element {
  /*
    [hash route]
      -> [route meta]
      -> [shell frame]
      -> [page-local view model]
      -> [real API page]
  */
  const [route, setRoute] = useState<AppRoute>(() => parseAppHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => {
      startTransition(() => {
        setRoute(parseAppHash(window.location.hash));
      });
    };

    window.addEventListener('hashchange', onHashChange);
    if (!window.location.hash) {
      navigateTo('/workspace');
    }

    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return (
    <AppRouteProvider navigate={navigateTo} route={route}>
      <ShellFrameCn route={route}>
        <RouteErrorBoundary resetKey={`${route.kind}:${window.location.hash || '#/workspace'}`}>
          <Suspense fallback={<RouteLoadingFallback />}>
            {route.kind === 'workspace' ? <WorkspacePage /> : null}
            {route.kind === 'composition-dashboard' ? <CompositionDashboardPage /> : null}
            {route.kind === 'composition-list' ? <CompositionListIndexPage /> : null}
            {route.kind === 'composition-backtest-runs' ? <CompositionBacktestRunsIndexPage /> : null}
            {route.kind === 'composition-lab' ? <CompositionLabIndexPage /> : null}
            {route.kind === 'leg-inventory' ? <LegInventoryPage /> : null}
            {route.kind === 'composition-workbench' ? <CompositionWorkbenchPage /> : null}
            {route.kind === 'composition-detail' ? (
              <CompositionDetailPage compositionId={route.compositionId} />
            ) : null}
            {route.kind === 'composition-backtest-new' ? (
              <CompositionBacktestConfigPage compositionId={route.compositionId} />
            ) : null}
            {route.kind === 'composition-backtest-result' ? (
              <CompositionBacktestResultPage
                compositionId={route.compositionId}
                highlightedEventId={route.eventId}
                highlightedOrderId={route.orderId}
                initialTab={route.tab}
                runId={route.runId}
              />
            ) : null}
            {route.kind === 'composition-allocation-config' ? (
              <CompositionAllocationConfigPage compositionId={route.compositionId} />
            ) : null}
            {route.kind === 'composition-allocation-result' ? (
              <CompositionAllocationResultPage compositionId={route.compositionId} jobId={route.jobId} />
            ) : null}
            {route.kind === 'creation-template' ? <CreationTemplatePage /> : null}
            {route.kind === 'asset-allocation-config' ? (
              <AssetAllocationConfigPage sessionId={route.sessionId} />
            ) : null}
            {route.kind === 'creation-session' ? <CreationSessionPage sessionId={route.sessionId} /> : null}
            {route.kind === 'strategy-detail' ? <StrategyDetailPage strategyId={route.strategyId} /> : null}
            {route.kind === 'backtest' ? (
              <BacktestSubmitPage
                periodYears={route.periodYears}
                sourceRunId={route.sourceRunId}
                strategyId={route.strategyId}
              />
            ) : null}
            {route.kind === 'runs-index' ? <RunsIndexPage /> : null}
            {route.kind === 'run' ? <RunDetailPage runId={route.runId} /> : null}
            {route.kind === 'snapshots' ? <SnapshotsPage /> : null}
            {route.kind === 'pit-data' ? (
              <PitCleaningCenterPage highlightedSection={route.section} initialLoadDelayMs={FIRST_SCREEN_DEFER_MS} />
            ) : null}
            {route.kind === 'factor-library' ? (
              <FactorLibraryPage
                initialLoadDelayMs={0}
                initialSource={route.source}
                initialStatus={route.status}
                initialTag={route.tag}
              />
            ) : null}
            {route.kind === 'factor-detail' ? <FactorDetailPage factorId={route.factorId} /> : null}
            {route.kind === 'factor-editor' ? <FactorEditorPage factorId={route.factorId} /> : null}
            {route.kind === 'public-factor-imports' ? <PublicFactorImportRoutePage /> : null}
            {route.kind === 'factor-factory' ? <FactorFactoryPage initialSection={route.section} /> : null}
            {route.kind === 'factor-model-builder' ? <FactorModelBuilderRoutePage route={route} /> : null}
            {route.kind === 'optimization-index' ? <OptimizationJobsIndexPage /> : null}
            {route.kind === 'optimization-select' ? (
              <OptimizationStrategySelectPage
                entryPoint={route.entryPoint}
                sourceRunId={route.sourceRunId}
                strategyId={route.strategyId}
              />
            ) : null}
            {route.kind === 'optimization-config' ? (
              <OptimizationConfigPage
                entryPoint={route.entryPoint}
                sourceRunId={route.sourceRunId}
                strategyId={route.strategyId}
              />
            ) : null}
            {route.kind === 'optimization' ? <OptimizationResultsPage jobId={route.jobId} /> : null}
          </Suspense>
        </RouteErrorBoundary>
      </ShellFrameCn>
      {isStaticDemoSyncPanelRequested() ? <StaticDemoCloudSync /> : null}
    </AppRouteProvider>
  );
}

export default function AppRuntimeCn(): JSX.Element {
  return (
    <ApiClientProvider>
      <AppShell />
    </ApiClientProvider>
  );
}

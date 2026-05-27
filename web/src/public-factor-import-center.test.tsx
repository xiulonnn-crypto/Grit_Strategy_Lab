import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PublicFactorImportCenterPage,
  type PublicFactorImportViewModel,
} from './pages/public-factor-import-center-page';

afterEach(() => {
  cleanup();
});

describe('PublicFactorImportCenterPage', () => {
  it('renders the approved first-screen flow without legacy breadcrumb or raw placeholders', () => {
    render(<PublicFactorImportCenterPage />);

    expect(screen.getByRole('heading', { level: 1, name: '公开因子入库中心' })).toBeInTheDocument();
    expect(screen.queryByText(/因子管理\s*\/\s*公开因子入库/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2026-05-21 16:20/)).not.toBeInTheDocument();

    const bodyText = document.body.textContent || '';
    ['来源准备', '获取 / 上传', '新建预检', '语义映射', '进入 B3 检疫'].forEach((label) => {
      expect(bodyText).toContain(label);
    });
    ['undefined', 'NaN', 'raw enum'].forEach((blocked) => {
      expect(bodyText).not.toContain(blocked);
    });
  });

  it('matches the approved dataset and mapping content contract', () => {
    render(<PublicFactorImportCenterPage />);

    const table = screen.getByRole('table', { name: '候选数据集' });
    ['数据集', '来源', '频率', '时间范围', '字段', '状态', '动作'].forEach((header) => {
      expect(within(table).getByRole('columnheader', { name: header })).toBeInTheDocument();
    });

    expect(within(table).getAllByText('待预检').length).toBeGreaterThanOrEqual(1);
    expect(within(table).getAllByRole('button', { name: '新建预检' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('需检疫').length).toBeGreaterThanOrEqual(4);
    expect(document.body.textContent || '').not.toContain('需检定');
  });

  it('removes the global precheck action from the header', () => {
    render(<PublicFactorImportCenterPage />);

    const heroActions = document.querySelector('.pfic-hero-actions') as HTMLElement;
    expect(within(heroActions).queryByRole('button', { name: '新建预检' })).not.toBeInTheDocument();
    expect(within(heroActions).getByRole('button', { name: '导入本地文件' })).toBeInTheDocument();
  });

  it('keeps the approved desktop grid contract in CSS', () => {
    const css = readFileSync('src/pages/public-factor-import-center-page.css', 'utf8');

    expect(css).toContain('grid-template-columns: 322px minmax(0, 1fr) 318px');
    expect(css).toContain('grid-row: 1 / 3');
    expect(css).toContain('grid-column: 2 / 4');
    expect(css).toContain('grid-column: 2;\n  grid-row: 2;\n  display: grid;\n  gap: 14px');
    expect(css).toContain('grid-column: 3;\n  grid-row: 2');
    expect(css).toContain('min-width: 760px');
    expect(css).toContain('grid-auto-flow: column');
    expect(css).toContain('grid-auto-columns: minmax(174px, 1fr)');
  });

  it('keeps the approved workbench DOM hierarchy from the design artifact', () => {
    const { container } = render(<PublicFactorImportCenterPage />);
    const layout = container.querySelector('.pfic-layout');

    expect(layout?.querySelector(':scope > .pfic-source-panel')).toBeTruthy();
    expect(layout?.querySelector(':scope > .pfic-flow-panel')).toBeTruthy();
    expect(layout?.querySelector(':scope > .pfic-main-stack > .pfic-candidates')).toBeTruthy();
    expect(layout?.querySelector(':scope > .pfic-main-stack > .pfic-mapping-workbench')).toBeTruthy();
    expect(layout?.querySelector(':scope > .pfic-manifest-rail')).toBeTruthy();
  });

  it('opens local file modal with template links and file input', () => {
    render(<PublicFactorImportCenterPage />);

    fireEvent.click(screen.getByRole('button', { name: '导入本地文件' }));
    expect(screen.getByRole('button', { name: /入口 B · 本地文件导入/ })).toHaveAttribute('aria-pressed', 'true');

    const modal = screen.getByRole('dialog', { name: '导入本地文件' });
    expect(within(modal).getByText('下载 source_template.xlsx')).toHaveAttribute(
      'href',
      '/factor-sources/templates/source_template.xlsx',
    );
    expect(within(modal).getByText('下载 manifest_template.xlsx')).toHaveAttribute(
      'href',
      '/factor-sources/templates/manifest_template.xlsx',
    );
    expect(within(modal).getByText('下载 mapping_template.xlsx')).toHaveAttribute(
      'href',
      '/factor-sources/templates/mapping_template.xlsx',
    );
    expect(within(modal).getByLabelText(/拖入 CSV 或 XLSX 文件/)).toHaveAttribute(
      'type',
      'file',
    );
  });

  it('updates entry, source, and dataset filter selected states through real controls', () => {
    render(<PublicFactorImportCenterPage />);

    const entryA = screen.getByRole('button', { name: /入口 A · 公开源预检/ });
    const entryB = screen.getByRole('button', { name: /入口 B · 本地文件导入/ });
    expect(entryA).toHaveAttribute('aria-pressed', 'true');
    expect(entryB).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(entryB);
    expect(entryA).toHaveAttribute('aria-pressed', 'false');
    expect(entryB).toHaveAttribute('aria-pressed', 'true');

    const french = screen.getByRole('button', { name: /French-Data Library/ });
    const aqr = screen.getByRole('button', { name: /AQR Data Library/ });
    expect(french).toHaveAttribute('aria-pressed', 'true');
    expect(aqr).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(aqr);
    expect(french).toHaveAttribute('aria-pressed', 'false');
    expect(aqr).toHaveAttribute('aria-pressed', 'true');
    const mappingWorkbench = document.querySelector('.pfic-mapping-workbench') as HTMLElement;
    expect(within(mappingWorkbench).getByText('QMJ')).toBeInTheDocument();
    expect(within(mappingWorkbench).getByText('PROF')).toBeInTheDocument();
    expect(within(mappingWorkbench).queryByText('SMB')).not.toBeInTheDocument();
    expect(screen.getByText('当前数据集：AQR QMJ Daily')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '待预检' }));
    expect(screen.getByRole('button', { name: '待预检' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('AQR QMJ Daily')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: '候选数据集' })).getAllByRole('button', { name: '新建预检' }).length).toBeGreaterThanOrEqual(1);
  });

  it('binds manifest audit and submitted status to the selected source and dataset', () => {
    const submittedManifest: PublicFactorImportViewModel['manifest'] = {
      jobId: 'extimp_ff5_submitted',
      sourceName: 'French-Data Library',
      datasetKey: 'ff_us_5f_daily',
      asOfDate: '2026-05-26T07:40:19Z',
      parserVersion: 'public_us_factor_template_v1',
      rawFileHash: 'sha256:submitted',
      rowCount: 94752,
      artifactPath: 'external_factor_import_manifests/extimp_ff5_submitted',
      reviewNote: 'SUBMITTED · REVIEW_BEFORE_QUARANTINE · b3_quarantine_completed',
      reviewStatus: 'SUBMITTED',
      nextActions: ['b3_quarantine_completed'],
      submitReady: false,
      reviewOutcome: 'B3 检疫通过 · 可发布候选',
      factorName: '[外部] - Fama-French 美股研究日频因子 (Daily) [Refined]',
      factorStatus: 'B3 通过，待发布准入',
      quarantineCandidateId: 'fq_ext_ff5',
    };

    render(
      <PublicFactorImportCenterPage
        viewModel={{
          manifest: submittedManifest,
          manifestsByDataset: {
            'ff_us_5f_daily': submittedManifest,
          },
        }}
      />,
    );

    const rail = document.querySelector('.pfic-manifest-rail') as HTMLElement;
    expect(within(rail).getByText('extimp_ff5_submitted')).toBeInTheDocument();
    expect(within(rail).getByText('ff_us_5f_daily')).toBeInTheDocument();
    expect(within(rail).getByText('送检结果')).toBeInTheDocument();
    expect(within(rail).getByText('B3 检疫通过 · 可发布候选')).toBeInTheDocument();
    expect(within(rail).getByText('[外部] - Fama-French 美股研究日频因子 (Daily) [Refined]')).toBeInTheDocument();
    expect(within(rail).getByText('B3 通过，待发布准入')).toBeInTheDocument();
    expect(screen.getAllByText('已送检').length).toBeGreaterThanOrEqual(2);
    expect((document.querySelector('[data-manifest-job-id="extimp_ff5_submitted"]') as HTMLElement)).toBeTruthy();
    expect(screen.getByRole('button', { name: /French-Data Library/ })).toHaveTextContent('已送检');

    fireEvent.click(screen.getByRole('button', { name: /AQR Data Library/ }));

    expect(within(rail).queryByText('extimp_ff5_submitted')).not.toBeInTheDocument();
    expect(within(rail).getByText('AQR Data Library')).toBeInTheDocument();
    expect(within(rail).getByText('aqr_us_qmj_daily')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /AQR Data Library/ })).not.toHaveTextContent('已送检');
  });

  it('keeps submitted monthly factor status in manifest audit instead of the action cell', () => {
    const monthlyManifest: PublicFactorImportViewModel['manifest'] = {
      jobId: 'extimp_monthly_submitted',
      sourceName: 'Fama-French Data Library',
      datasetKey: 'fama_french_us_research_factors_monthly',
      asOfDate: '2026-05-27T07:24:00Z',
      parserVersion: 'public_us_factor_template_v1',
      rawFileHash: 'sha256:monthly',
      rowCount: 4518,
      artifactPath: 'external_factor_import_manifests/extimp_monthly_submitted',
      reviewNote: 'SUBMITTED · REVIEW_BEFORE_QUARANTINE · b3_quarantine_completed',
      reviewStatus: 'SUBMITTED',
      nextActions: ['b3_quarantine_completed'],
      submitReady: false,
      reviewOutcome: 'B3 检疫通过 · 可发布候选',
      factorName: '[外部] - US research factors monthly (Monthly) [Refined]',
      factorStatus: 'B3 通过，待发布准入',
      quarantineCandidateId: 'fq_ext_monthly',
      targetFactorId: 's_f2_mom_raw_cur_external_fama_french_us_research_factors_monthly',
    };

    render(
      <PublicFactorImportCenterPage
        viewModel={{
          activeSourceId: 'fama_french',
          activeDatasetId: 'fama_french_us_research_factors_monthly',
          sources: [{
            id: 'fama_french',
            name: 'Fama-French Data Library',
            kind: 'auto',
            tone: 'ready',
            frequency: '日频 / 月频',
            badges: ['可自动导入'],
            description: '公开学术研究因子。',
          }],
          datasets: [{
            id: 'fama_french_us_research_factors_monthly',
            name: 'US research factors monthly',
            key: 'fama_french_us_research_factors_monthly',
            sourceName: 'Fama-French',
            frequency: '月频',
            coverage: '1926-07 至今',
            status: 'importable',
            fieldCount: 8,
          }],
          manifest: monthlyManifest,
          manifestsByDataset: {
            'fama_french_us_research_factors_monthly': monthlyManifest,
          },
        }}
      />,
    );

    const table = screen.getByRole('table', { name: '候选数据集' });
    const auditButton = within(table).getByRole('button', { name: '查看审计' });
    const actionCell = auditButton.closest('td') as HTMLElement;
    expect(within(actionCell).queryByText('[外部] - US research factors monthly (Monthly) [Refined]')).not.toBeInTheDocument();
    expect(within(actionCell).queryByText('B3 通过，待发布准入')).not.toBeInTheDocument();

    const rail = document.querySelector('.pfic-manifest-rail') as HTMLElement;
    expect(within(rail).getByText('[外部] - US research factors monthly (Monthly) [Refined]')).toBeInTheDocument();
    expect(within(rail).getByText('B3 通过，待发布准入')).toBeInTheDocument();

    fireEvent.click(auditButton);

    expect(screen.getByText(/已打开送检审计/)).toHaveTextContent('[外部] - US research factors monthly (Monthly) [Refined]');
    expect(screen.getByText(/已打开送检审计/)).toHaveTextContent('B3 通过，待发布准入');
  });

  it('shows a pending AQR source-manifest precheck as review state after refresh', async () => {
    const pendingAqrManifest: PublicFactorImportViewModel['manifest'] = {
      jobId: 'extimp_aqr_pending',
      sourceName: 'AQR Data Sets',
      datasetKey: 'aqr_public_style_factors',
      asOfDate: '2026-05-27T09:46:35Z',
      parserVersion: 'aqr_public_style_factors',
      rawFileHash: '等待文件 hash',
      rowCount: 0,
      artifactPath: 'external_factor_import_manifests/extimp_aqr_pending',
      reviewNote: 'PENDING_REVIEW · REVIEW_BEFORE_QUARANTINE · upload_source_file / inspect_manifest',
      reviewStatus: 'PENDING_REVIEW',
      nextActions: ['upload_source_file', 'inspect_manifest'],
      submitReady: false,
    };
    const submittedAqrManifest: PublicFactorImportViewModel['manifest'] = {
      ...pendingAqrManifest,
      reviewNote: 'SUBMITTED · REVIEW_BEFORE_QUARANTINE · b3_quarantine_completed',
      reviewStatus: 'SUBMITTED',
      nextActions: ['b3_quarantine_completed'],
      submitReady: false,
      reviewOutcome: 'B3 检疫阻断 · 等待源文件',
      factorStatus: '源文件未物化，保留人工复核证据',
    };
    const submitReview = vi.fn().mockResolvedValue({
      manifest: submittedAqrManifest,
      manifestsByDataset: {
        aqr_public_style_factors: submittedAqrManifest,
      },
    });

    render(
      <PublicFactorImportCenterPage
        api={{ submitReview }}
        viewModel={{
          activeSourceId: 'aqr',
          activeDatasetId: 'aqr-qmj',
          manifest: pendingAqrManifest,
          manifestsByDataset: {
            aqr_public_style_factors: pendingAqrManifest,
          },
        }}
      />,
    );

    const table = screen.getByRole('table', { name: '候选数据集' });
    const qmjRow = within(table).getByText('AQR QMJ Daily').closest('tr') as HTMLElement;
    const tsmomRow = within(table).getByText('AQR TSMOM Monthly').closest('tr') as HTMLElement;

    expect(qmjRow).toHaveAttribute('data-manifest-job-id', 'extimp_aqr_pending');
    expect(within(qmjRow).getByText('待送检')).toBeInTheDocument();
    expect(within(qmjRow).getByRole('button', { name: '查看 manifest' })).toBeInTheDocument();
    expect(within(qmjRow).queryByRole('button', { name: '新建预检' })).not.toBeInTheDocument();
    expect(tsmomRow).not.toHaveAttribute('data-manifest-job-id', 'extimp_aqr_pending');

    const railSubmitButton = document.querySelector('.pfic-manifest-rail .pfic-button-primary') as HTMLButtonElement;
    expect(railSubmitButton).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(railSubmitButton);
    });
    expect(submitReview).toHaveBeenCalledWith({ jobId: 'extimp_aqr_pending' });
    expect(screen.getByText(/已进入 B3 检疫/)).toBeInTheDocument();
  });

  it('keeps candidate dataset filters aligned with displayed status labels', () => {
    const submittedManifest: PublicFactorImportViewModel['manifest'] = {
      jobId: 'extimp_ff5_submitted',
      sourceName: 'French-Data Library',
      datasetKey: 'ff_us_5f_daily',
      asOfDate: '2026-05-26T07:40:19Z',
      parserVersion: 'public_us_factor_template_v1',
      rawFileHash: 'sha256:submitted',
      rowCount: 94752,
      artifactPath: 'external_factor_import_manifests/extimp_ff5_submitted',
      reviewNote: 'SUBMITTED 进入 REVIEW_BEFORE_QUARANTINE 进入 b3_quarantine_completed',
      reviewStatus: 'SUBMITTED',
      nextActions: ['b3_quarantine_completed'],
      submitReady: false,
    };

    render(
      <PublicFactorImportCenterPage
        viewModel={{
          manifest: submittedManifest,
          manifestsByDataset: {
            'ff_us_5f_daily': submittedManifest,
          },
        }}
      />,
    );

    const filters = document.querySelector('.dataset-panel .pfic-segmented') as HTMLElement;
    const table = document.querySelector('.pfic-dataset-table') as HTMLElement;

    fireEvent.click(within(filters).getByRole('button', { name: '已送检' }));
    expect(within(filters).getByRole('button', { name: '已送检' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(table).getByText('Fama-French 5 Factors Daily')).toBeInTheDocument();
    expect(within(table).getByText('已送检')).toBeInTheDocument();
    expect(within(table).queryByText('AQR QMJ Daily')).not.toBeInTheDocument();

    fireEvent.click(within(filters).getByRole('button', { name: '待预检' }));
    expect(within(filters).getByRole('button', { name: '待预检' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(table).getByText('Fama-French Momentum')).toBeInTheDocument();
    expect(within(table).getAllByText('待预检').length).toBeGreaterThanOrEqual(1);
    expect(within(table).getByText('AQR QMJ Daily')).toBeInTheDocument();
    expect(within(table).getAllByRole('button', { name: '新建预检' }).length).toBeGreaterThanOrEqual(1);
    expect(within(table).queryByText('可生成模板')).not.toBeInTheDocument();
    expect(within(table).queryByText('Fama-French 5 Factors Daily')).not.toBeInTheDocument();

    fireEvent.click(within(filters).getByRole('button', { name: '待送检' }));
    expect(within(filters).getByRole('button', { name: '待送检' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(table).queryByText('AQR QMJ Daily')).not.toBeInTheDocument();
    expect(within(table).queryByText('Fama-French 5 Factors Daily')).not.toBeInTheDocument();
  });

  it('waits for the live view model before showing candidate dataset statuses', async () => {
    const submittedManifest: PublicFactorImportViewModel['manifest'] = {
      jobId: 'extimp_ff5_submitted',
      sourceName: 'French-Data Library',
      datasetKey: 'ff_us_5f_daily',
      asOfDate: '2026-05-26T07:40:19Z',
      parserVersion: 'public_us_factor_template_v1',
      rawFileHash: 'sha256:submitted',
      rowCount: 94752,
      artifactPath: 'external_factor_import_manifests/extimp_ff5_submitted',
      reviewNote: 'SUBMITTED 进入 REVIEW_BEFORE_QUARANTINE 进入 b3_quarantine_completed',
      reviewStatus: 'SUBMITTED',
      nextActions: ['b3_quarantine_completed'],
      submitReady: false,
    };
    let resolveViewModel!: (value: Partial<PublicFactorImportViewModel>) => void;
    const loadPromise = new Promise<Partial<PublicFactorImportViewModel>>((resolve) => {
      resolveViewModel = resolve;
    });

    render(<PublicFactorImportCenterPage api={{ loadViewModel: () => loadPromise }} />);

    expect(screen.getByRole('status')).toHaveTextContent('正在同步公开源与送检状态');
    expect(screen.queryByText('Fama-French 5 Factors Daily')).not.toBeInTheDocument();
    expect(screen.queryByText('待预检')).not.toBeInTheDocument();

    await act(async () => {
      resolveViewModel({
        manifest: submittedManifest,
        manifestsByDataset: {
          'ff_us_5f_daily': submittedManifest,
        },
      });
      await loadPromise;
    });

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByText('Fama-French 5 Factors Daily')).toBeInTheDocument();
    expect(screen.getAllByText('已送检').length).toBeGreaterThanOrEqual(2);
  });

  it('maps live registry dataset keys to dataset-specific semantic mappings', () => {
    render(
      <PublicFactorImportCenterPage
        viewModel={{
          activeSourceId: 'aqr',
          activeDatasetId: 'aqr_us_qmj_daily',
          datasets: [
            {
              id: 'aqr_us_qmj_daily',
              name: 'AQR QMJ Daily',
              key: 'aqr_us_qmj_daily',
              sourceName: 'AQR',
              frequency: '日频',
              coverage: '许可待核',
              status: 'review',
              fieldCount: 4,
            },
          ],
        }}
      />,
    );

    const mappingWorkbench = document.querySelector('.pfic-mapping-workbench') as HTMLElement;
    expect(within(mappingWorkbench).getByText('QMJ')).toBeInTheDocument();
    expect(within(mappingWorkbench).getByText('SAFETY')).toBeInTheDocument();
    expect(within(mappingWorkbench).queryByText('SMB')).not.toBeInTheDocument();
  });

  it('gives feedback for draft, manifest, and artifact actions', () => {
    render(<PublicFactorImportCenterPage />);

    const table = screen.getByRole('table', { name: '候选数据集' });
    fireEvent.click(within(table).getAllByRole('button', { name: '新建预检' })[0]);
    fireEvent.click(within(screen.getByRole('dialog', { name: '新建预检' })).getByRole('button', { name: '保存草稿' }));
    expect(screen.queryByRole('dialog', { name: '新建预检' })).not.toBeInTheDocument();
    expect(screen.getByText(/预检草稿已保存/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '导入本地文件' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: '导入本地文件' })).getByRole('button', { name: '保存上传草稿' }));
    expect(screen.queryByRole('dialog', { name: '导入本地文件' })).not.toBeInTheDocument();
    expect(screen.getByText(/上传草稿已保存/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下载 manifest' }));
    expect(screen.getByText(/manifest 下载已准备/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '打开 artifact' }));
    expect(screen.getByText(/artifact 路径已确认/)).toBeInTheDocument();
  });

  it('gates submit review until a real import job is ready', async () => {
    const submittedManifest: PublicFactorImportViewModel['manifest'] = {
      jobId: 'extimp_ready',
      sourceName: 'Fama-French Data Library',
      datasetKey: 'fama_french_us_research_factors_daily',
      asOfDate: '2026-05-22',
      parserVersion: 'public_us_factor_template_v1',
      rawFileHash: 'sha256:ready',
      rowCount: 18,
      artifactPath: 'external_factor_import_manifests/extimp_ready',
      reviewNote: 'SUBMITTED · REVIEW_BEFORE_QUARANTINE · b3_quarantine_completed',
      reviewStatus: 'SUBMITTED',
      nextActions: ['b3_quarantine_completed'],
      submitReady: false,
    };
    const submitReview = vi.fn().mockResolvedValue({ manifest: submittedManifest });
    const { container, rerender } = render(<PublicFactorImportCenterPage api={{ submitReview }} />);

    const blockedButton = container.querySelector('.pfic-manifest-rail .pfic-button-primary') as HTMLButtonElement;
    expect(blockedButton).toBeDisabled();
    fireEvent.click(blockedButton);
    expect(submitReview).not.toHaveBeenCalled();

    rerender(
      <PublicFactorImportCenterPage
        api={{ submitReview }}
        viewModel={{
          manifest: {
            jobId: 'extimp_ready',
            sourceName: 'Fama-French Data Library',
            datasetKey: 'fama_french_us_research_factors_daily',
            asOfDate: '2026-05-22',
            parserVersion: 'public_us_factor_template_v1',
            rawFileHash: 'waiting',
            rowCount: 0,
            artifactPath: 'external_factor_import_manifests/extimp_ready',
            reviewNote: 'READY_FOR_REVIEW',
            reviewStatus: 'READY_FOR_REVIEW',
            nextActions: ['inspect_manifest', 'submit_review'],
            submitReady: true,
          },
        }}
      />,
    );

    const readyButton = container.querySelector('.pfic-manifest-rail .pfic-button-primary') as HTMLButtonElement;
    expect(readyButton).not.toBeDisabled();
    await act(async () => {
      fireEvent.click(readyButton);
    });
    expect(submitReview).toHaveBeenCalledWith({ jobId: 'extimp_ready' });
    expect(screen.getAllByText(/已进入 B3 检疫/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('B3 检疫完成').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/SUBMITTED · REVIEW_BEFORE_QUARANTINE · b3_quarantine_completed/)).toBeInTheDocument();
    expect(readyButton).toHaveTextContent('已送检');
    expect(readyButton).toBeDisabled();
  });

  it('opens precheck modal and calls injected API client with selected source and dataset', async () => {
    const createPrecheck = vi.fn().mockResolvedValue({});
    render(<PublicFactorImportCenterPage api={{ createPrecheck }} />);

    const table = screen.getByRole('table', { name: '候选数据集' });
    fireEvent.click(within(table).getAllByRole('button', { name: '新建预检' })[0]);
    const modal = screen.getByRole('dialog', { name: '新建预检' });
    expect(within(modal).getByText('预检配置')).toBeInTheDocument();
    expect(within(modal).getByDisplayValue('French-Data Library')).toBeInTheDocument();
    expect(within(modal).getByDisplayValue('Fama-French 5 Factors Daily')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(within(modal).getByRole('button', { name: '开始预检' }));
    });
    expect(createPrecheck).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'french',
        datasetId: 'ff5-daily',
        importMode: 'AUTO_DOWNLOAD',
        boundary: '候选模板，不直接发布',
      }),
    );
  });

  it('uses a source-manifest precheck for AQR instead of automatic download', async () => {
    const createPrecheck = vi.fn().mockResolvedValue({});
    render(<PublicFactorImportCenterPage api={{ createPrecheck }} />);

    fireEvent.click(screen.getByRole('button', { name: /AQR Data Library/ }));
    const table = screen.getByRole('table', { name: '候选数据集' });
    const qmjRow = within(table).getByText('AQR QMJ Daily').closest('tr') as HTMLElement;
    fireEvent.click(within(qmjRow).getByRole('button', { name: '新建预检' }));
    const modal = screen.getByRole('dialog', { name: '新建预检' });

    await act(async () => {
      fireEvent.click(within(modal).getByRole('button', { name: '开始预检' }));
    });

    expect(createPrecheck).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceId: 'aqr',
        datasetId: 'aqr-qmj',
        importMode: 'SOURCE_MANIFEST',
        parserMode: '来源 manifest 预检',
      }),
    );
  });

  it('uses the candidate-row submit action only when the selected manifest is ready', async () => {
    const submittedManifest: PublicFactorImportViewModel['manifest'] = {
      jobId: 'extimp_ready',
      sourceName: 'Fama-French Data Library',
      datasetKey: 'fama_french_us_research_factors_daily',
      asOfDate: '2026-05-22',
      parserVersion: 'public_us_factor_template_v1',
      rawFileHash: 'sha256:ready',
      rowCount: 18,
      artifactPath: 'external_factor_import_manifests/extimp_ready',
      reviewNote: 'SUBMITTED · REVIEW_BEFORE_QUARANTINE · b3_quarantine_completed',
      reviewStatus: 'SUBMITTED',
      nextActions: ['b3_quarantine_completed'],
      submitReady: false,
      reviewOutcome: 'B3 检疫通过 · 可发布候选',
      factorName: '[外部] - Fama-French 美股研究日频因子 (Daily) [Refined]',
      factorStatus: 'B3 通过，待发布准入',
    };
    const submitReview = vi.fn().mockResolvedValue({ manifest: submittedManifest });

    render(
      <PublicFactorImportCenterPage
        api={{ submitReview }}
        viewModel={{
          manifest: {
            jobId: 'extimp_ready',
            sourceName: 'Fama-French Data Library',
            datasetKey: 'fama_french_us_research_factors_daily',
            asOfDate: '2026-05-22',
            parserVersion: 'public_us_factor_template_v1',
            rawFileHash: 'waiting',
            rowCount: 0,
            artifactPath: 'external_factor_import_manifests/extimp_ready',
            reviewNote: 'READY_FOR_REVIEW',
            reviewStatus: 'READY_FOR_REVIEW',
            nextActions: ['inspect_manifest', 'submit_review'],
            submitReady: true,
          },
        }}
      />,
    );

    const table = screen.getByRole('table', { name: '候选数据集' });
    expect(within(table).getAllByText('待送检').length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      fireEvent.click(within(table).getByRole('button', { name: '送入复核' }));
    });

    expect(submitReview).toHaveBeenCalledWith({ jobId: 'extimp_ready' });
    expect(screen.getByText('送检结果')).toBeInTheDocument();
    expect(screen.getByText('B3 检疫通过 · 可发布候选')).toBeInTheDocument();
  });

  it('uses injected view model while keeping fallback-safe formatting', () => {
    const viewModel: Partial<PublicFactorImportViewModel> = {
      activeSourceId: 'custom-source',
      activeDatasetId: 'custom-dataset',
      sources: [
        {
          id: 'custom-source',
          name: 'Custom Public Source',
          kind: 'manual',
          tone: 'warning',
          frequency: '周频',
          badges: ['手动上传'],
          description: '需要许可复核后进入预检。',
        },
      ],
      datasets: [
        {
          id: 'custom-dataset',
          name: 'Custom Dataset',
          key: 'custom_dataset',
          sourceName: 'Custom',
          frequency: '周频',
          coverage: '',
          status: 'review',
        },
      ],
    };

    render(<PublicFactorImportCenterPage viewModel={viewModel} />);

    expect(screen.getAllByText('Custom Public Source').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Custom Dataset').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('待确认').length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent || '').not.toContain('undefined');
  });
});

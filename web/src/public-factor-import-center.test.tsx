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

    expect(within(table).getByText('候选模板')).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: '查看 manifest' })).toBeInTheDocument();
    expect(screen.getAllByText('需检疫').length).toBeGreaterThanOrEqual(4);
    expect(document.body.textContent || '').not.toContain('需检定');
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

    fireEvent.click(screen.getByRole('button', { name: '待复核' }));
    expect(screen.getByRole('button', { name: '待复核' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('AQR QMJ Daily')).toBeInTheDocument();
    expect(screen.queryByText('Fama-French 5 Factors Daily')).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: '新建预检' }));
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
    expect(screen.getByText('B3 检疫完成')).toBeInTheDocument();
    expect(screen.getByText(/SUBMITTED · REVIEW_BEFORE_QUARANTINE · b3_quarantine_completed/)).toBeInTheDocument();
    expect(readyButton).toHaveTextContent('已送检');
    expect(readyButton).toBeDisabled();
  });

  it('opens precheck modal and calls injected API client with selected source and dataset', async () => {
    const createPrecheck = vi.fn().mockResolvedValue({});
    render(<PublicFactorImportCenterPage api={{ createPrecheck }} />);

    fireEvent.click(screen.getByRole('button', { name: '新建预检' }));
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
        boundary: '候选模板，不直接发布',
      }),
    );
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

    expect(screen.getByText('Custom Public Source')).toBeInTheDocument();
    expect(screen.getByText('Custom Dataset')).toBeInTheDocument();
    expect(screen.getAllByText('待确认').length).toBeGreaterThanOrEqual(1);
    expect(document.body.textContent || '').not.toContain('undefined');
  });
});

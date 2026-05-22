import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('../../../web/node_modules/playwright');

const outDir = 'C:/Fin/Grit_Strategy_Lab/output/ui-artifact-trace/public-factor-import-center';
const rawLeakPatterns = [
  'Fama-French Data Library',
  'PUBLIC_DOWNLOAD',
  'US research factors daily',
  'aqr_public_style_factors',
];

async function pageTextLeaks(page) {
  const text = await page.locator('body').innerText();
  return rawLeakPatterns.filter((pattern) => text.includes(pattern));
}

async function box(page, selector) {
  return page.locator(selector).first().evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  });
}

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });

const desktop = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const desktopUrl = 'http://127.0.0.1:4173/?v=public-factor-import-ui-review-final-desktop#/factors/imports';
await desktop.goto(desktopUrl, { waitUntil: 'networkidle' });
await desktop.locator('.pfic-page').waitFor({ state: 'visible', timeout: 30000 });
await desktop.screenshot({ path: path.join(outDir, 'live-desktop.png'), fullPage: true, animations: 'disabled' });

const desktopMetrics = {
  url: desktopUrl,
  rawLeaks: await pageTextLeaks(desktop),
  mappingBadge: await desktop.locator('.pfic-mapping-workbench .pfic-panel-heading > span').innerText(),
  flowBadge: await desktop.locator('.pfic-flow-panel .pfic-panel-heading > span').innerText(),
  hero: await box(desktop, '.pfic-hero'),
  kpi: await box(desktop, '.pfic-kpi-strip'),
  source: await box(desktop, '.pfic-source-panel'),
  flow: await box(desktop, '.pfic-flow-panel'),
  mainStack: await box(desktop, '.pfic-main-stack'),
  candidates: await box(desktop, '.pfic-candidates'),
  mapping: await box(desktop, '.pfic-mapping-workbench'),
  manifest: await box(desktop, '.pfic-manifest-rail'),
  overflowX: await desktop.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
};

const precheck = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
await precheck.goto('http://127.0.0.1:4173/?v=public-factor-import-ui-review-final-precheck#/factors/imports', { waitUntil: 'networkidle' });
await precheck.getByRole('button', { name: '新建预检' }).click();
await precheck.locator('.modal-precheck').waitFor({ state: 'visible' });
await precheck.screenshot({ path: path.join(outDir, 'live-modal-create-precheck.png'), fullPage: true, animations: 'disabled' });

const precheckMetrics = {
  title: await precheck.locator('#pfic-precheck-title').innerText(),
  buttons: await precheck.locator('.modal-precheck button').evaluateAll((els) => els.map((el) => el.textContent?.trim() || '')),
};

const localFile = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
await localFile.goto('http://127.0.0.1:4173/?v=public-factor-import-ui-review-final-localfile#/factors/imports', { waitUntil: 'networkidle' });
await localFile.getByRole('button', { name: '导入本地文件' }).click();
await localFile.locator('.modal-import').waitFor({ state: 'visible' });
await localFile.screenshot({ path: path.join(outDir, 'live-modal-local-file.png'), fullPage: true, animations: 'disabled' });

const localFileMetrics = {
  title: await localFile.locator('#pfic-local-file-title').innerText(),
  templates: await localFile.locator('.pfic-template-card strong').evaluateAll((els) => els.map((el) => el.textContent?.trim() || '')),
};

const mobile = await browser.newPage({ viewport: { width: 390, height: 980 }, deviceScaleFactor: 1 });
const mobileUrl = 'http://127.0.0.1:4173/?v=public-factor-import-ui-review-final-mobile#/factors/imports';
await mobile.goto(mobileUrl, { waitUntil: 'networkidle' });
await mobile.locator('.pfic-page').waitFor({ state: 'visible', timeout: 30000 });
await mobile.screenshot({ path: path.join(outDir, 'live-mobile.png'), fullPage: true, animations: 'disabled' });

const mobileMetrics = {
  url: mobileUrl,
  rawLeaks: await pageTextLeaks(mobile),
  mappingBadge: await mobile.locator('.pfic-mapping-workbench .pfic-panel-heading > span').innerText(),
  overflowX: await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
};

await browser.close();

const metrics = {
  desktop: desktopMetrics,
  mobile: mobileMetrics,
  precheckModal: precheckMetrics,
  localFileModal: localFileMetrics,
};

await fs.writeFile(path.join(outDir, 'live-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(metrics, null, 2));

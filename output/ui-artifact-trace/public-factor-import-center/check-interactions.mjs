import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('../../../web/node_modules/playwright');

const outDir = 'C:/Fin/Grit_Strategy_Lab/output/ui-artifact-trace/public-factor-import-center';
await fs.mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
const url = 'http://127.0.0.1:4173/?v=public-factor-import-interactions#/factors/imports';
const events = [];

page.on('console', (message) => {
  if (message.type() === 'error') {
    events.push({ type: 'console-error', text: message.text() });
  }
});
page.on('pageerror', (error) => {
  events.push({ type: 'page-error', text: error.message });
});
page.on('requestfailed', (request) => {
  events.push({ type: 'request-failed', url: request.url(), failure: request.failure()?.errorText || '' });
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.locator('.pfic-page').waitFor({ state: 'visible', timeout: 30000 });

async function classList(selector, index = 0) {
  return page.locator(selector).nth(index).evaluate((el) => Array.from(el.classList));
}

async function textList(selector) {
  return page.locator(selector).evaluateAll((els) => els.map((el) => el.textContent?.trim() || ''));
}

async function pressedList(selector) {
  return page.locator(selector).evaluateAll((els) => els.map((el) => ({
    text: el.textContent?.trim().replace(/\s+/g, ' ') || '',
    pressed: el.getAttribute('aria-pressed'),
    tag: el.tagName,
    classes: Array.from(el.classList),
  })));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const report = {
  url,
  before: {
    entryCards: await pressedList('.pfic-entry-card'),
    sourceCards: await pressedList('.pfic-source-card'),
    segmented: await pressedList('.pfic-segmented button'),
    visibleDatasets: await textList('.pfic-dataset-row td:first-child strong'),
    mappingCards: await textList('.pfic-mapping-card h3'),
  },
  after: {},
  events,
};

assert(report.before.mappingCards.includes('SMB'), 'default FF5 mapping should show SMB before switching dataset');

const entryCards = page.locator('.pfic-entry-card');
if (await entryCards.count() >= 2) {
  await entryCards.nth(1).click({ force: true });
  report.after.entryBClick = await pressedList('.pfic-entry-card');
}

const sourceCards = page.locator('.pfic-source-card');
if (await sourceCards.count() >= 2) {
  await sourceCards.nth(1).click();
  await page.waitForFunction(() => {
    const titles = Array.from(document.querySelectorAll('.pfic-mapping-card h3')).map((el) => el.textContent?.trim() || '');
    return titles.includes('QMJ');
  }, null, { timeout: 5000 });
  report.after.sourceAqrClick = {
    cards: await pressedList('.pfic-source-card'),
    classes0: await classList('.pfic-source-card', 0),
    classes1: await classList('.pfic-source-card', 1),
    activeDataset: await page.locator('.pfic-mapping-workbench .pfic-panel-heading p').innerText(),
    mappingCards: await textList('.pfic-mapping-card h3'),
  };
  assert(report.after.sourceAqrClick.mappingCards.includes('QMJ'), 'AQR QMJ mapping should show QMJ');
  assert(!report.after.sourceAqrClick.mappingCards.includes('SMB'), 'AQR QMJ mapping should not keep FF5 SMB card');
}

await page.getByRole('button', { name: '待复核' }).click();
report.after.filterReviewClick = {
  segmented: await pressedList('.pfic-segmented button'),
  visibleDatasets: await textList('.pfic-dataset-row td:first-child strong'),
};

await page.getByRole('button', { name: '新建预检' }).click();
await page.locator('.modal-precheck').waitFor({ state: 'visible' });
await page.getByRole('button', { name: '保存草稿' }).click();
report.after.precheckDraftClick = {
  modalStillOpen: await page.locator('.modal-precheck').isVisible().catch(() => false),
  statusText: await page.locator('.pfic-inline-status').textContent().catch(() => ''),
};

await page.getByRole('button', { name: '导入本地文件' }).click();
await page.locator('.modal-import').waitFor({ state: 'visible' });
await page.getByRole('button', { name: '取消' }).click();
report.after.localFileCancelClick = {
  modalStillOpen: await page.locator('.modal-import').isVisible().catch(() => false),
};

await page.getByRole('button', { name: '下载 manifest' }).click();
report.after.downloadManifestClick = {
  statusText: await page.locator('.pfic-inline-status').textContent().catch(() => ''),
};

await page.getByRole('button', { name: '打开 artifact' }).click();
report.after.openArtifactClick = {
  statusText: await page.locator('.pfic-inline-status').textContent().catch(() => ''),
};

await page.screenshot({ path: path.join(outDir, 'interaction-check.png'), fullPage: true, animations: 'disabled' });
await browser.close();

await fs.writeFile(path.join(outDir, 'interaction-check.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));

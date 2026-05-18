import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = process.cwd();
const requireFromWeb = createRequire(path.join(root, 'web', 'package.json'));
const { chromium } = requireFromWeb('playwright');
const outDir = path.join(root, 'output', 'ui-artifact-trace', 'factor-factory-design-parity-20260518');
await fs.mkdir(outDir, { recursive: true });

const artifactDir = path.join(root, 'output', 'ui-artifact-trace', 'factor-factory-b1-b4-phase2-20260518');
const designUrl = pathToFileURL(path.join(artifactDir, 'factor-factory-b1-b4-phase2-ui.html')).href;
const liveUrl = `http://127.0.0.1:4173/?v=${Date.now()}#/factors/factory`;

function roundedBox(box) {
  if (!box) return null;
  return {
    x: Number(box.x.toFixed(3)),
    y: Number(box.y.toFixed(3)),
    width: Number(box.width.toFixed(3)),
    height: Number(box.height.toFixed(3)),
  };
}

async function measure(page, label) {
  await page.setViewportSize({ width: 1960, height: 1600 });
  if (label === 'design') {
    await page.goto(designUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.hero');
  } else {
    await page.goto(liveUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-page-root="factor-factory"]');
    await page.waitForTimeout(900);
  }
  await page.screenshot({
    path: path.join(outDir, `${label}-final-1960.png`),
    fullPage: true,
  });
  return page.evaluate((labelArg) => {
    const selectorMap = labelArg === 'design'
      ? {
          page: '.app',
          hero: '.hero',
          statusStrip: '.status-strip',
          metrics: '.summary-grid',
          publish: '.publish-queue',
          workbench: '.layers',
          firstPanel: '.panel',
          admission: '.admission',
          modal: '.modal',
        }
      : {
          page: '[data-page-root="factor-factory"]',
          hero: '.factor-factory-hero',
          statusStrip: '.factor-factory-status-strip',
          metrics: '.factor-factory-funnel',
          publish: '.factory-publish-queue',
          workbench: '.factor-factory-workbench',
          firstPanel: '.factor-factory-fixed-panel',
          admission: '.factor-factory-admission-rules',
          modal: '[role="dialog"]',
        };
    const read = (name) => {
      const el = document.querySelector(selectorMap[name]);
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        x: Number(rect.x.toFixed(3)),
        y: Number(rect.y.toFixed(3)),
        width: Number(rect.width.toFixed(3)),
        height: Number(rect.height.toFixed(3)),
        radius: style.borderRadius,
        columns: style.gridTemplateColumns,
        overflowX: style.overflowX,
        overflowY: style.overflowY,
      };
    };
    const body = document.documentElement;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      noHorizontalScroll: body.scrollWidth <= body.clientWidth,
      scrollWidth: body.scrollWidth,
      clientWidth: body.clientWidth,
      page: read('page'),
      hero: read('hero'),
      statusStrip: read('statusStrip'),
      metrics: read('metrics'),
      publish: read('publish'),
      workbench: read('workbench'),
      firstPanel: read('firstPanel'),
      admission: read('admission'),
      modal: read('modal'),
      factorFactoryClasses: Array.from(document.querySelectorAll('[class*="factor-factory"], [class*="summary-grid"], [class*="layers"], [class*="admission"]'))
        .map((el) => String(el.getAttribute('class') ?? ''))
        .filter(Boolean)
        .slice(0, 80),
    };
  }, label);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ deviceScaleFactor: 1 });
const page = await context.newPage();
const design = await measure(page, 'design');
const live = await measure(page, 'live');
await browser.close();

const delta = {};
for (const key of ['hero', 'statusStrip', 'metrics', 'workbench', 'firstPanel', 'admission']) {
  const a = design[key];
  const b = live[key];
  if (!a || !b) {
    delta[key] = { designPresent: Boolean(a), livePresent: Boolean(b) };
    continue;
  }
  delta[key] = {
    x: Number((b.x - a.x).toFixed(3)),
    y: Number((b.y - a.y).toFixed(3)),
    width: Number((b.width - a.width).toFixed(3)),
    height: Number((b.height - a.height).toFixed(3)),
    radius: `${a.radius} -> ${b.radius}`,
    columns: `${a.columns} -> ${b.columns}`,
  };
}

await fs.writeFile(
  path.join(outDir, 'geometry-final.json'),
  JSON.stringify({ designUrl, liveUrl, design, live, delta }, null, 2),
  'utf8',
);

console.log(JSON.stringify({
  outDir,
  liveUrl,
  noHorizontalScroll: live.noHorizontalScroll,
  delta,
}, null, 2));

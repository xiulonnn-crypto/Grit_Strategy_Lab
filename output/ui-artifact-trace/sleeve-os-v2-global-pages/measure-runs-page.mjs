import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const dir = dirname(fileURLToPath(import.meta.url));
const target = 'http://127.0.0.1:4173/?v=sleeve-os-v2-size#/runs';

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1039 }, deviceScaleFactor: 1 });
  await page.goto(target, { waitUntil: 'networkidle', timeout: 30000 });
  const metrics = await page.evaluate(() => {
    const app = document.querySelector('#root') ?? document.body;
    const shell = document.querySelector('.app-shell, [class*="shell"], main') ?? document.body;
    const pageRoot =
      document.querySelector('[data-page-root="runs-index"], .runs-index-page, .runs-page, main section') ??
      document.querySelector('main') ??
      document.body;
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      body: { width: document.body.scrollWidth, height: document.body.scrollHeight },
      app: rect(app),
      shell: rect(shell),
      pageRoot: rect(pageRoot),
      hash: window.location.hash,
      title: document.title,
    };
  });
  await page.screenshot({ path: join(dir, 'runs-live-reference.png'), fullPage: false, animations: 'disabled' });
  writeFileSync(join(dir, 'runs-live-measurement.json'), `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(metrics, null, 2));
} finally {
  await browser.close();
}

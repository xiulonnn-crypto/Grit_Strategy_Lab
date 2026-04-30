import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const htmlPath = join(dir, 'sleeve-os-v2-global-pages-preview.html');
const url = pathToFileURL(htmlPath).href;
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const targets = [
  ['composition-list', 'composition-list-desktop.png', { width: 1920, height: 1039 }],
  ['composition-backtests', 'composition-backtests-desktop.png', { width: 1920, height: 1039 }],
  ['composition-lab', 'composition-lab-desktop.png', { width: 1920, height: 1039 }],
  ['composition-list', 'composition-list-mobile.png', { width: 390, height: 1200 }],
  ['composition-backtests', 'composition-backtests-mobile.png', { width: 390, height: 1200 }],
  ['composition-lab', 'composition-lab-mobile.png', { width: 390, height: 1200 }],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1039 }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'load' });
  await page.emulateMedia({ media: 'screen' });

  for (const [id, filename, viewport] of targets) {
    await page.setViewportSize(viewport);
    await page.goto(`${url}#${id}`, { waitUntil: 'load' });
    if (viewport.width >= 1000) {
      await page.screenshot({ path: join(dir, filename), fullPage: false, animations: 'disabled' });
    } else {
      const locator = page.locator(`#${id}`);
      await locator.scrollIntoViewIfNeeded();
      await locator.screenshot({ path: join(dir, filename), animations: 'disabled' });
    }
  }
} finally {
  await browser.close();
}

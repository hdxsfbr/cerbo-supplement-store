// Render slides/*.html to slides/png/*.png (1920×1080) with headless Chrome. Usage: node slides.mjs
import puppeteer from 'puppeteer-core';
import { mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';

const HERE = path.resolve(new URL('.', import.meta.url).pathname);
const OUT = path.join(HERE, 'slides', 'png');
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME ?? '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--force-device-scale-factor=1'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
for (const f of readdirSync(path.join(HERE, 'slides')).filter((n) => n.endsWith('.html'))) {
  await page.goto('file://' + path.join(HERE, 'slides', f), { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(OUT, f.replace(/\.html$/, '.png')) });
  console.log('rendered', f);
}
await browser.close();

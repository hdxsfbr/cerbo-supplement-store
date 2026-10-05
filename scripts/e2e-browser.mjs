// Repeatable browser run of quickstart scenario 2 (HDX-90): builder → send → patient pay
// (double-click) → reload shows receipt → provider audit balanced. Needs a running stack and
// Chrome. Usage:
//   BASE=http://localhost:5173 CHROME=/usr/bin/google-chrome node scripts/e2e-browser.mjs
// Requires `puppeteer-core` (npm i -D puppeteer-core, or run from a dir that has it).
import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
const BASE = (process.env.BASE ?? 'http://localhost:5173').replace(/\/$/, '');
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const OUT = process.env.OUT ?? 'docs/screenshots/e2e';
mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errs = [];
page.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) errs.push(`[console] ${m.text()}`);
});

// Provider: start order for Hera (patient 2), add Omega-3 ×2 and Vitamin D3 at 2.00 (200¢ → half-cent fee boundary)
await page.goto(`${BASE}/orders/new`, { waitUntil: 'networkidle0' });
await page.select('select[aria-label="Patient"]', '2');
await page.click('button::-p-text(Start supplement order)');
await page.waitForSelector('select[aria-label="Supplement"]');
const opts = await page.$$eval('select[aria-label="Supplement"] option', (os) =>
  os.map((o) => [o.value, o.textContent]),
);
const omega = opts.find((o) => o[1].includes('Omega-3'))[0];
const vitd = opts.find((o) => o[1].includes('Vitamin D3'))[0];
await page.select('select[aria-label="Supplement"]', omega);
await page.click('button::-p-text(Add)');
await page.select('select[aria-label="Supplement"]', omega);
await page.click('button::-p-text(Add)');
await page.select('select[aria-label="Supplement"]', vitd);
await page.click('button::-p-text(Add)');
await new Promise((r) => setTimeout(r, 700));
const priceInputs = await page.$$('input[id^="price-"]');
await priceInputs[1].click();
await page.keyboard.down('Control');
await page.keyboard.press('a');
await page.keyboard.up('Control');
await page.keyboard.type('2.00');
await page.keyboard.press('Tab');
await new Promise((r) => setTimeout(r, 900));
await page.click('button::-p-text(Send to patient for payment)');
await page.waitForFunction(() => document.body.innerText.includes('Payment link'));
const url = await page.$eval('.ob__link-url', (e) => e.textContent.trim());
const orderId = await page.evaluate(() => location.pathname.split('/').pop());
console.log('ORDER', orderId, 'URL', url);

// Patient: checkout
console.log('step: goto checkout');
await page.goto(url, { waitUntil: 'networkidle0' });
console.log('step: checkout loaded');
await page.screenshot({ path: `${OUT}/checkout.png`, fullPage: true });
const payBtn = await page.waitForSelector('button.portal-btn--primary');
console.log('step: pay button');
// double-click: two rapid clicks → second is a no-op (disabled) or a replay
await payBtn.click();
await payBtn.click().catch(() => {});
await page.waitForFunction(() => document.body.innerText.includes('Paid'), { timeout: 15000 });
console.log('step: paid');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/receipt.png`, fullPage: true });
// refresh → still receipt
await page.reload({ waitUntil: 'networkidle0' });
console.log(
  'AFTER RELOAD paid banner:',
  await page.evaluate(() => document.body.innerText.includes('Paid — thank you')),
);

// Provider: audit
await page.goto(`${BASE}/orders/${orderId}/audit`, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => document.body.innerText.includes('BALANCED'));
await page.screenshot({ path: `${OUT}/audit.png`, fullPage: true });
console.log(
  'AUDIT text:',
  await page.evaluate(() => document.querySelector('.cerbo-balance')?.textContent.trim()),
);
console.log(errs.length ? errs.join('\n') : 'no page errors');
if (errs.length) process.exitCode = 1;
await browser.close();

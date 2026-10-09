// Demo recorder: drives the live app in headless Chrome (1920×1080), screencasts each scene to a
// WebM, and paces every scene to the length of its narration WAV. A visible cursor is injected
// into the page so clicks read naturally. Usage (from docs/demo):
//   BASE=https://app-production-500d.up.railway.app node record.mjs
import puppeteer from 'puppeteer-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.env.BASE ?? 'https://app-production-500d.up.railway.app').replace(/\/$/, '');
const CHROME = process.env.CHROME ?? '/usr/bin/google-chrome';
const HERE = path.resolve(new URL('.', import.meta.url).pathname);
const CLIPS = path.join(HERE, 'clips');
mkdirSync(CLIPS, { recursive: true });

const audioDur = (id) =>
  Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(HERE, 'audio', `${id}_norm.wav`)]).toString().trim());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = process.env.SCENES ? process.env.SCENES.split(',') : null;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--window-size=1920,1080', '--hide-scrollbars', '--force-device-scale-factor=1'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });

// ── Visible cursor overlay (headless screencasts have no pointer) ─────────────────────────
const CURSOR_CSS = `
#__cur{position:fixed;left:0;top:0;width:22px;height:30px;pointer-events:none;z-index:2147483647;
 transform:translate(-2px,-2px);transition:none;filter:drop-shadow(0 1px 1px rgba(0,0,0,.5))}
#__cur svg{display:block}
#__cur.click::after{content:"";position:absolute;left:-14px;top:-14px;width:40px;height:40px;border-radius:50%;
 border:3px solid rgba(248,215,74,.95);animation:__pulse .45s ease-out forwards}
@keyframes __pulse{from{transform:scale(.4);opacity:1}to{transform:scale(1.4);opacity:0}}`;
const CURSOR_SVG = `<svg width="22" height="30" viewBox="0 0 22 30"><path d="M2 2 L2 23 L7.5 18 L11 27 L15 25.5 L11.5 17 L19 17 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
let cur = { x: 960, y: 540 };
async function installCursor() {
  await page.evaluate((css, svg, x, y) => {
    if (document.getElementById('__cur')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const d = document.createElement('div'); d.id = '__cur'; d.innerHTML = svg; d.style.transform = `translate(${x}px,${y}px)`; document.body.appendChild(d);
  }, CURSOR_CSS, CURSOR_SVG, cur.x, cur.y);
}
page.setDefaultTimeout(20000);
page.on('framenavigated', (f) => { if (f === page.mainFrame()) page.evaluate(() => void 0).then(installCursor).catch(() => {}); });
async function moveTo(x, y, ms = 650) {
  const steps = Math.max(12, Math.round(ms / 16));
  const sx = cur.x, sy = cur.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps, e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease in-out
    const nx = sx + (x - sx) * e, ny = sy + (y - sy) * e;
    await page.evaluate((px, py) => { const d = document.getElementById('__cur'); if (d) d.style.transform = `translate(${px}px,${py}px)`; }, nx, ny);
    await page.mouse.move(nx, ny);
    await sleep(16);
  }
  cur = { x, y };
}
async function clickOn(selectorOrHandle, opts = {}) {
  log('  click', typeof selectorOrHandle === 'string' ? selectorOrHandle : '(handle)');
  const el = typeof selectorOrHandle === 'string' ? await page.waitForSelector(selectorOrHandle, { visible: true }) : selectorOrHandle;
  const box = await el.boundingBox();
  if (!box) throw new Error('no box for ' + selectorOrHandle);
  const x = box.x + box.width * (opts.fx ?? 0.5), y = box.y + box.height * (opts.fy ?? 0.5);
  await moveTo(x, y, opts.ms ?? 650);
  await page.evaluate(() => { const d = document.getElementById('__cur'); d?.classList.remove('click'); void d?.offsetWidth; d?.classList.add('click'); });
  await page.mouse.click(x, y);
  await sleep(opts.after ?? 350);
}
async function typeSlow(text, perChar = 55) {
  for (const ch of text) { await page.keyboard.type(ch); await sleep(perChar); }
}
async function selectAll() { await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); }

// ── Scene runner: screencast for exactly the narration length (actions may finish early) ──
async function scene(id, fn) {
  if (ONLY && !ONLY.includes(id)) { log(id, 'skipped'); return; }
  const dur = audioDur(id);
  log(id, 'start');
  const out = path.join(CLIPS, `${id}.webm`);
  const t0 = Date.now();
  const rec = await page.screencast({ path: out });
  try {
    await fn();
  } finally {
    const elapsed = (Date.now() - t0) / 1000;
    const remaining = dur + 0.6 - elapsed;
    if (remaining > 0) await sleep(remaining * 1000);
    await rec.stop();
    console.log(`${id}: audio ${dur.toFixed(2)}s, actions ${elapsed.toFixed(2)}s${remaining < 0 ? '  ⚠ actions overran audio by ' + (-remaining).toFixed(1) + 's' : ''}`);
  }
}
async function goto(url) { await page.goto(url, { waitUntil: 'networkidle0' }); await installCursor(); }
const slide = (name) => 'file://' + path.join(HERE, 'slides', name);

// ─────────────────────────────────────────────────────────────────────────────────────────
// Static slides (s01, s07) are built from PNGs by mux.sh; screencast emits no frames on a still page.

// s02 — order builder
await goto(`${BASE}/orders/new`);
await scene('s02_builder', async () => {
  await sleep(1500);
  await clickOn('select[aria-label="Patient"]');
  await page.select('select[aria-label="Patient"]', '1'); // Zeus King
  await sleep(600);
  await clickOn('button::-p-text(Start supplement order)');
  await page.waitForSelector('select[aria-label="Supplement"]');
  await sleep(800);
  const opts = await page.$$eval('select[aria-label="Supplement"] option', (os) => os.map((o) => [o.value, o.textContent]));
  const omega = opts.find((o) => o[1].includes('Omega-3'))[0];
  const vitd = opts.find((o) => o[1].includes('Vitamin D3'))[0];
  await clickOn('select[aria-label="Supplement"]');
  await page.select('select[aria-label="Supplement"]', omega); await sleep(300);
  await clickOn('button::-p-text(Add)');
  await sleep(500);
  await clickOn('select[aria-label="Supplement"]');
  await page.select('select[aria-label="Supplement"]', vitd); await sleep(300);
  await clickOn('button::-p-text(Add)');
  await sleep(1200);
  // override the vitamin D price to $9.50
  const priceInputs = await page.$$('input[id^="price-"]');
  await clickOn(priceInputs[1], { fx: 0.8 });
  await selectAll(); await typeSlow('9.50'); await page.keyboard.press('Tab');
  await sleep(1400);
  // type a target margin on Omega-3 → price derives
  const pct = await page.$$('input[aria-label^="Margin percent"]');
  await clickOn(pct[0], { fx: 0.8 });
  await selectAll(); await typeSlow('45'); await page.keyboard.press('Tab');
  await sleep(2200);
  // hover the billing panel so the eye follows the narration
  const bill = await page.$('.cerbo-split-preview');
  if (bill) { const b = await bill.boundingBox(); await moveTo(b.x + b.width * 0.5, b.y + b.height * 0.6, 900); }
  await sleep(4500);
  await clickOn('button::-p-text(Send to patient for payment)', { ms: 800 });
  await page.waitForFunction(() => document.body.innerText.includes('Sent to patient'));
  await sleep(500);
  const notes = await page.$('.ob__notes'); if (notes) { const b = await notes.boundingBox(); await moveTo(b.x + 40, b.y + 20, 700); }
});

// s03 — portal + pay (declined, then good)
const portalUrl = await page.$eval('a::-p-text(View as patient)', (a) => a.href);
await scene('s03_portal_pay', async () => {
  const btn = await page.$('a::-p-text(View as patient)');
  if (btn) { const b = await btn.boundingBox(); await moveTo(b.x + b.width / 2, b.y + b.height / 2, 500); }
  await sleep(300);
  await goto(portalUrl);
  log('  portal loaded');
  await sleep(2200);
  await clickOn('a::-p-text(Review and pay)', { ms: 800 });
  await page.waitForSelector('#cc-number');
  await installCursor();
  await sleep(1200);
  await clickOn('#cc-name'); await typeSlow('Zeus King', 45);
  await clickOn('button::-p-text(Declined)', { ms: 500 });
  await sleep(500);
  await clickOn('button[type=submit]', { ms: 500 });
  await page.waitForFunction(() => document.body.innerText.includes('declined'), { timeout: 20000 });
  log('  decline shown');
  await sleep(2600);
  await clickOn('button::-p-text(Succeeds)', { ms: 500 });
  await sleep(400);
  await clickOn('button[type=submit]', { ms: 500 });
  await page.waitForFunction(() => document.body.innerText.includes('Paid — thank you'), { timeout: 20000 });
  log('  paid');
  await installCursor();
  await sleep(2500);
  await page.reload({ waitUntil: 'networkidle0' }); await installCursor();
  const rc = await page.$('.portal-receipt'); if (rc) { const b = await rc.boundingBox(); await moveTo(b.x + b.width * 0.7, b.y + b.height * 0.5, 700); }
});

// s04 — audit (provider)
const orderId = await page.evaluate(() => document.body.innerText.match(/Order #(\d+)/)?.[1]);
log('order id for audit:', orderId);
await goto(`${BASE}/orders/${orderId}/audit`);
await scene('s04_audit', async () => {
  await sleep(1500);
  const rows = await page.$$('.audit__ledger tbody tr');
  for (const r of rows) { const b = await r.boundingBox(); await moveTo(b.x + b.width * 0.45, b.y + b.height / 2, 700); await sleep(900); }
  const fee = await page.$('.audit__fee-table'); if (fee) { const b = await fee.boundingBox(); await moveTo(b.x + b.width * 0.8, b.y + b.height * 0.6, 900); }
  await sleep(6000);
  const bal = await page.$('.cerbo-balance'); if (bal) { const b = await bal.boundingBox(); await moveTo(b.x + b.width * 0.5, b.y + b.height / 2, 900); }
});

// s05 — dashboard
await goto(`${BASE}/dashboard`);
await scene('s05_dashboard', async () => {
  await sleep(1200);
  const tiles = await page.$$('.dash__tiles .cerbo-panel');
  for (const t of tiles) { const b = await t.boundingBox(); await moveTo(b.x + b.width / 2, b.y + b.height * 0.6, 500); await sleep(350); }
  const inv = await page.$('.cerbo-chip--warn'); if (inv) { const b = await inv.boundingBox(); await moveTo(b.x + b.width / 2, b.y + b.height / 2, 900); }
});

// s06 — under the hood slide
await goto(slide('s06_under_hood.html'));
await scene('s06_under_hood', async () => {
  await moveTo(470, 520, 600);
  await moveTo(480, 520, 900); await sleep(5000);
  await moveTo(1400, 520, 900);
});


await browser.close();
console.log('done');

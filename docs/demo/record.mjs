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

const AUDIO_DIR = process.env.AUDIO_DIR ?? 'audio';
// DRY=1: no narration yet — run every scene's actions once (selector check) without pacing.
const audioDur = (id) =>
  process.env.DRY
    ? 0
    : Number(
        execFileSync('ffprobe', [
          '-v',
          'error',
          '-show_entries',
          'format=duration',
          '-of',
          'csv=p=0',
          path.join(HERE, AUDIO_DIR, `${id}_norm.wav`),
        ])
          .toString()
          .trim(),
      );

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ONLY = process.env.SCENES ? process.env.SCENES.split(',') : null;
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const want = (id) => !ONLY || ONLY.includes(id);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--window-size=1920,1080',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
  ],
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
  await page.evaluate(
    (css, svg, x, y) => {
      if (document.getElementById('__cur')) return;
      const st = document.createElement('style');
      st.textContent = css;
      document.head.appendChild(st);
      const d = document.createElement('div');
      d.id = '__cur';
      d.innerHTML = svg;
      d.style.transform = `translate(${x}px,${y}px)`;
      document.body.appendChild(d);
    },
    CURSOR_CSS,
    CURSOR_SVG,
    cur.x,
    cur.y,
  );
}
page.setDefaultTimeout(20000);
page.on('framenavigated', (f) => {
  if (f === page.mainFrame())
    page
      .evaluate(() => void 0)
      .then(installCursor)
      .catch(() => {});
});
async function moveTo(x, y, ms = 650) {
  const steps = Math.max(12, Math.round(ms / 16));
  const sx = cur.x,
    sy = cur.y;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps,
      e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease in-out
    const nx = sx + (x - sx) * e,
      ny = sy + (y - sy) * e;
    await page.evaluate(
      (px, py) => {
        const d = document.getElementById('__cur');
        if (d) d.style.transform = `translate(${px}px,${py}px)`;
      },
      nx,
      ny,
    );
    await page.mouse.move(nx, ny);
    await sleep(16);
  }
  cur = { x, y };
}
async function clickOn(selectorOrHandle, opts = {}) {
  log('  click', typeof selectorOrHandle === 'string' ? selectorOrHandle : '(handle)');
  const el =
    typeof selectorOrHandle === 'string'
      ? await page.waitForSelector(selectorOrHandle, { visible: true })
      : selectorOrHandle;
  let box = await el.boundingBox();
  if (!box) throw new Error('no box for ' + selectorOrHandle);
  // Clicks are by coordinates: bring off-screen targets into view first (the portal frame is tall).
  if (box.y < 0 || box.y + box.height > 1080) {
    await el.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await sleep(450);
    box = await el.boundingBox();
  }
  const x = box.x + box.width * (opts.fx ?? 0.5),
    y = box.y + box.height * (opts.fy ?? 0.5);
  await moveTo(x, y, opts.ms ?? 650);
  await page.evaluate(() => {
    const d = document.getElementById('__cur');
    d?.classList.remove('click');
    void d?.offsetWidth;
    d?.classList.add('click');
  });
  await page.mouse.click(x, y);
  await sleep(opts.after ?? 350);
}
async function typeSlow(text, perChar = 55) {
  for (const ch of text) {
    await page.keyboard.type(ch);
    await sleep(perChar);
  }
}
async function selectAll() {
  await page.keyboard.down('Control');
  await page.keyboard.press('a');
  await page.keyboard.up('Control');
}

// ── Scene runner: screencast for exactly the narration length (actions may finish early) ──
async function scene(id, fn) {
  if (ONLY && !ONLY.includes(id)) {
    log(id, 'skipped');
    return;
  }
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
    console.log(
      `${id}: audio ${dur.toFixed(2)}s, actions ${elapsed.toFixed(2)}s${remaining < 0 ? '  ⚠ actions overran audio by ' + (-remaining).toFixed(1) + 's' : ''}`,
    );
  }
}
async function goto(url) {
  await page.goto(url, { waitUntil: 'networkidle0' });
  await installCursor();
}
const slide = (name) => 'file://' + path.join(HERE, 'slides', name);

// ─────────────────────────────────────────────────────────────────────────────────────────
// Static slides (s01, s07) are built from PNGs by mux.sh; screencast emits no frames on a still page.

// ── Helpers for this demo ────────────────────────────────────────────────────────────────
async function signIn(email) {
  await goto(`${BASE}/`);
  await sleep(600);
  await clickOn('#login-email');
  await page.select('#login-email', email);
  await sleep(500);
  await clickOn('button[type=submit]', { ms: 700 });
}
async function hoverEl(selector, fx = 0.5, fy = 0.5, ms = 800) {
  const el = typeof selector === 'string' ? await page.$(selector) : selector;
  if (!el) return;
  let b = await el.boundingBox();
  if (b && (b.y < 0 || b.y + b.height > 1080)) {
    await el.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    await sleep(450);
    b = await el.boundingBox();
  }
  if (b) await moveTo(b.x + b.width * fx, b.y + b.height * fy, ms);
}
// Re-runnable: Zeus's list rows and open requests from a previous take are cleared first.
async function resetZeus() {
  const h = { 'x-acting-provider': '1', 'content-type': 'application/json' };
  const list = await (await fetch(`${BASE}/api/patients/1/supplements`, { headers: h })).json();
  for (const r of list.supplements.filter((x) => x.status === 'active')) {
    await fetch(`${BASE}/api/patient-supplements/${r.id}`, {
      method: 'PATCH',
      headers: h,
      body: JSON.stringify({ status: 'discontinued' }),
    });
  }
  const reqs = await (await fetch(`${BASE}/api/requests`, { headers: h })).json();
  for (const r of reqs.requests.filter((x) => x.status === 'requested')) {
    await fetch(`${BASE}/api/requests/${r.id}/decline`, { method: 'POST', headers: h, body: '{}' });
  }
  log('reset: zeus list + requests cleared');
}
if (want('s02_chart')) await resetZeus();

// ─────────────────────────────────────────────────────────────────────────────────────────
// Static slides (s01, s09) are built from PNGs by mux.sh; screencast emits no frames on a still page.

// s02 — chart: sign in, Supplements tab, add two supplements to the list, create the order
await goto(`${BASE}/`);
let firstOrderId = null;
await scene('s02_chart', async () => {
  await signIn('welby@demo.cer.bo');
  await page.waitForSelector('select[aria-label="Search patients"]');
  await sleep(400);
  await clickOn('select[aria-label="Search patients"]');
  await page.select('select[aria-label="Search patients"]', '1'); // Zeus King
  await page.waitForFunction(() => document.body.innerText.includes('Unreviewed for Zeus King'));
  await sleep(400);
  await clickOn('span.xc-tab::-p-text(Supplements)', { ms: 450 });
  await sleep(350);
  await clickOn('span.xc-tabs__add', { ms: 450 });
  await page.waitForSelector('input.xc-pick__search');
  await sleep(300);
  await clickOn('input.xc-pick__search');
  await typeSlow('omega', 55);
  await sleep(350);
  await clickOn('div.xc-pick__row--on', { ms: 400 });
  await page.waitForSelector('fieldset.xc-fs select');
  await sleep(350);
  await clickOn('fieldset.xc-fs select:nth-of-type(1)');
  await page.select('fieldset.xc-fs select:nth-of-type(1)', '2');
  await sleep(300);
  await clickOn('fieldset.xc-fs select:nth-of-type(3)');
  await page.select('fieldset.xc-fs select:nth-of-type(3)', 'with meals');
  await sleep(400);
  await clickOn('button.xc-btn::-p-text(Add Another)', { ms: 450 });
  await page.waitForSelector('input.xc-pick__search');
  await sleep(300);
  await clickOn('input.xc-pick__search');
  await typeSlow('vitamin d', 55);
  await sleep(350);
  await clickOn('div.xc-pick__row--on', { ms: 400 });
  await page.waitForSelector('button.xc-btn::-p-text(Add to List)');
  await sleep(400);
  await clickOn('button.xc-btn::-p-text(Add to List)', { ms: 450 });
  await page.waitForFunction(() => document.querySelectorAll('.xc-supp').length >= 2);
  await sleep(400);
  for (const cb of await page.$$('.xc-supp input[type=checkbox]')) await clickOn(cb, { ms: 400 });
  await sleep(400);
  await clickOn('a::-p-text(Create supplement order)', { ms: 450 });
  await page.waitForSelector('.ob__patient');
  await sleep(400);
});
firstOrderId = await page.evaluate(() => document.body.innerText.match(/Order #(\d+)/)?.[1]);
log('first order id:', firstOrderId);

// s03 — order page: margin → $10.00 vitamin D (total $42.00, fee 31.5¢ → 32¢), split, send
await scene('s03_order', async () => {
  await sleep(2500);
  const lines = await page.$$('.ob__lines tbody tr');
  for (const l of lines) {
    await hoverEl(l, 0.2, 0.5, 500);
    await sleep(500);
  }
  await sleep(1500);
  const pct = await page.$$('input[aria-label^="Margin percent"]');
  await clickOn(pct[1], { fx: 0.3 }); // vitamin D is the second line (list order)
  await selectAll();
  await typeSlow('60');
  await page.keyboard.press('Tab');
  await sleep(2600);
  await hoverEl('.cerbo-split-preview', 0.5, 0.6, 900);
  await sleep(6500);
  await clickOn('button::-p-text(Send to patient for payment)', { ms: 800 });
  await page.waitForFunction(() => document.body.innerText.includes('Sent to patient'));
  await sleep(500);
  await hoverEl('.ob__notes', 0.1, 0.2, 700);
});

// s04 — patient: sign in, pay from Secure Messages (declined, then good), request a refill
if (want('s04_portal_pay')) {
  await clickOn('button.xc-nav__user', { ms: 500 });
  await clickOn('.xc-menu__item::-p-text(Sign out)', { ms: 500 });
  await page.waitForSelector('#login-email');
}
await scene('s04_portal_pay', async () => {
  await signIn('zeus@olympus.example');
  await page.waitForSelector('.xp-side__hi');
  await sleep(700);
  await clickOn('.xp-nav a::-p-text(Secure Messages)', { ms: 700 });
  await page.waitForSelector('a::-p-text(Pay Now)');
  await sleep(900);
  await clickOn('a::-p-text(Pay Now)', { ms: 800 });
  await page.waitForSelector('#cc-number');
  await installCursor();
  await sleep(700);
  await clickOn('#cc-name');
  await typeSlow('Zeus King', 45);
  await sleep(600);
  await clickOn('button::-p-text(Declined)', { ms: 700 });
  await sleep(600);
  await clickOn('button[type=submit]', { ms: 600 });
  await page.waitForFunction(() => document.body.innerText.includes('declined'), {
    timeout: 20000,
  });
  log('  decline shown');
  await hoverEl('.portal-status--error', 0.3, 0.5, 600);
  await sleep(1600);
  await clickOn('button::-p-text(Succeeds)', { ms: 700 });
  await sleep(500);
  await clickOn('button[type=submit]', { ms: 600 });
  await page.waitForFunction(() => document.body.innerText.includes('Paid — thank you'), {
    timeout: 20000,
  });
  log('  paid');
  await installCursor();
  await hoverEl('.portal-receipt', 0.7, 0.6, 800);
  await sleep(1400);
  await page.reload({ waitUntil: 'networkidle0' });
  await installCursor();
  await hoverEl('.portal-receipt', 0.7, 0.5, 700);
  await sleep(1400);
  await clickOn('.xp-nav a::-p-text(My Supplements)', { ms: 800 });
  await page.waitForSelector('.xp-table tbody tr');
  await sleep(900);
  const cb = await page.$('.xp-table tbody tr input[type=checkbox]');
  if (cb) await clickOn(cb, { ms: 600 });
  await clickOn('.xp-request input');
  await typeSlow('Running low', 50);
  await sleep(400);
  await clickOn('button::-p-text(Request an Order)', { ms: 700 });
  await page.waitForSelector('.xp-reqrow');
  await hoverEl('.xp-reqrow', 0.2, 0.5, 700);
});

// s05 — provider: the request on the chart → create order → send
if (want('s05_request')) {
  await clickOn('.xp-side__out', { ms: 500 });
  await page.waitForSelector('#login-email');
  await signIn('welby@demo.cer.bo');
  await page.waitForSelector('select[aria-label="Search patients"]');
  await page.select('select[aria-label="Search patients"]', '1');
  await page.waitForFunction(() => document.body.innerText.includes('Unreviewed for Zeus King'));
}
await scene('s05_request', async () => {
  await sleep(600);
  await clickOn('span.xc-tab::-p-text(Supplements)', { ms: 600 });
  await page.waitForSelector('.xc-req');
  await hoverEl('.xc-req', 0.3, 0.5, 700);
  await sleep(1200);
  await clickOn('.xc-req__act a::-p-text(Create order)', { ms: 700 });
  await page.waitForSelector('.ob__patient');
  await sleep(1000);
  await clickOn('button::-p-text(Send to patient for payment)', { ms: 700 });
  await page.waitForFunction(() => document.body.innerText.includes('Sent to patient'));
  await sleep(400);
});

// s06 — audit of the first (paid) order
if (want('s06_audit')) await goto(`${BASE}/orders/${firstOrderId}/audit`);
await scene('s06_audit', async () => {
  await sleep(2500);
  const rows = await page.$$('.audit__ledger tbody tr');
  for (const r of rows) {
    await hoverEl(r, 0.45, 0.5, 700);
    await sleep(1500);
  }
  const fee = await page.$('.audit__fee-table');
  if (fee) {
    await hoverEl(fee, 0.8, 0.3, 900);
    await sleep(2500);
    await hoverEl(fee, 0.8, 0.9, 900);
  }
  await sleep(4500);
  await hoverEl('.cerbo-balance', 0.5, 0.5, 900);
  await sleep(4000);
  await hoverEl('.audit__memo', 0.4, 0.5, 900);
});

// s07 — Orders list → Sales report (via the Supplements menu)
if (want('s07_reporting')) {
  if (ONLY) {
    // re-recording this scene alone: establish the provider session first
    await signIn('welby@demo.cer.bo');
    await page.waitForSelector('button.xc-nav__user');
  }
  await goto(`${BASE}/orders`);
}
await scene('s07_reporting', async () => {
  await sleep(800);
  await clickOn('.ol__tab::-p-text(Paid)', { ms: 700 });
  await sleep(900);
  await clickOn('.ol__sort::-p-text(Total)', { ms: 600 });
  await sleep(1100);
  await goto(`${BASE}/dashboard`);
  await sleep(600);
  const tiles = await page.$$('.dash__tiles .cerbo-panel');
  for (const t of tiles) {
    await hoverEl(t, 0.5, 0.6, 400);
    await sleep(250);
  }
  await sleep(1000);
  await sleep(2500);
  await hoverEl('.dash__tiles .cerbo-panel', 0.5, 0.6, 600);
});

// s08 — under the hood slide
if (want('s08_under_hood')) await goto(slide('s08_under_hood.html'));
await scene('s08_under_hood', async () => {
  await moveTo(470, 520, 600);
  await sleep(8500);
  await moveTo(1400, 520, 900);
  await sleep(6000);
  await moveTo(1400, 760, 800);
});

await browser.close();
console.log('done');

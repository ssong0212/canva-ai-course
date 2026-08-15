/*
 * tools/e2e.js — loads the unpacked extension into Chromium, serves a test
 * page, and checks that the pet mounts, walks, reacts and can be dragged.
 *
 *   NODE_PATH=$(npm root -g) node tools/e2e.js [--shots <dir>]
 */
const http = require('http');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const shotIdx = process.argv.indexOf('--shots');
const SHOTS = shotIdx > -1 ? process.argv[shotIdx + 1] : null;

const PAGE = `<!doctype html><meta charset="utf-8"><title>test page</title>
<style>body{font:16px system-ui;margin:0;padding:40px;background:#fff;color:#333}
h1{font-size:22px}</style>
<h1>A boring page for the pet to live on</h1>
<p>Scroll, click, drag — the pet should keep doing its thing.</p>`;

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(PAGE);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function petState(page) {
  return page.evaluate(() => {
    const host = document.getElementById('pixel-pet-host');
    const cv = host && host.shadowRoot && host.shadowRoot.querySelector('canvas');
    if (!cv) return null;
    const r = cv.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  });
}

(async () => {
  const { srv, port } = await serve();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pxpet-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: 'chromium',
    viewport: { width: 900, height: 600 },
    args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`]
  });

  try {
    let [sw] = ctx.serviceWorkers();
    if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 10000 });
    const extId = new URL(sw.url()).host;
    check('service worker started', !!extId, extId);

    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`http://127.0.0.1:${port}/`);
    await page.bringToFront(); // background tabs throttle rAF, which stalls the pet
    await page.waitForFunction(() => {
      const h = document.getElementById('pixel-pet-host');
      return !!(h && h.shadowRoot && h.shadowRoot.querySelector('canvas'));
    }, { timeout: 10000 });

    const first = await petState(page);
    check('pet mounted', !!first, first && JSON.stringify(first));
    check('pet sits on the floor',
      Math.abs(first.y + first.h - 600) < 12,
      `bottom=${(first.y + first.h).toFixed(1)}`);
    check('pet uses the default size', Math.round(first.w) === 72, `w=${first.w}`);

    // It should walk off on its own. The pet picks its next move at random and
    // a nap can run for a while, so give it a generous window.
    let moved = false;
    let waited = 0;
    for (let i = 0; i < 60 && !moved; i++) {
      await page.waitForTimeout(500);
      waited += 500;
      const s = await petState(page);
      if (Math.abs(s.x - first.x) > 4) moved = true;
    }
    check('pet wanders on its own', moved, `after ${waited}ms`);

    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'page.png') });

    // chase: move the cursor next to it
    const before = await petState(page);
    await page.mouse.move(before.x + 300, 560, { steps: 12 });
    await page.waitForTimeout(1200);
    const after = await petState(page);
    check('pet chases the cursor', after.x > before.x + 10,
      `${before.x.toFixed(0)} -> ${after.x.toFixed(0)}`);

    // drag it to the middle of the screen and drop it
    const grab = await petState(page);
    await page.mouse.move(grab.x + grab.w / 2, grab.y + grab.h / 2);
    await page.mouse.down();
    await page.mouse.move(450, 150, { steps: 16 });
    const lifted = await petState(page);
    check('pet follows the pointer while dragged', lifted.y < 260, `y=${lifted.y.toFixed(0)}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'dragging.png') });
    await page.mouse.up();
    await page.waitForTimeout(1500);
    const landed = await petState(page);
    check('pet falls back to the floor after a drop',
      Math.abs(landed.y + landed.h - 600) < 12,
      `bottom=${(landed.y + landed.h).toFixed(1)}`);

    // settings apply live
    await sw.evaluate(() => chrome.storage.sync.set({ pet: 'chick', size: 120 }));
    await page.waitForTimeout(600);
    const resized = await petState(page);
    check('size setting applies live', Math.round(resized.w) === 120, `w=${resized.w}`);
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'chick-120.png') });

    await sw.evaluate(() => chrome.storage.sync.set({ enabled: false }));
    await page.waitForTimeout(500);
    check('disabling removes the pet', (await petState(page)) === null);

    await sw.evaluate(() => chrome.storage.sync.set({ enabled: true, pet: 'cat', size: 72 }));
    await page.waitForTimeout(500);
    check('re-enabling brings it back', (await petState(page)) !== null);

    // the popup should render without errors
    const popup = await ctx.newPage();
    const popupErrors = [];
    popup.on('pageerror', (e) => popupErrors.push(String(e)));
    await popup.goto(`chrome-extension://${extId}/src/popup.html`);
    await popup.waitForTimeout(800);
    const petButtons = await popup.locator('#pets button').count();
    check('popup lists every pet', petButtons === 4, `${petButtons} buttons`);
    check('popup has no script errors', popupErrors.length === 0, popupErrors.join(' | '));
    if (SHOTS) await popup.screenshot({ path: path.join(SHOTS, 'popup.png') });

    check('no page errors from the content script', errors.length === 0, errors.join(' | '));
  } finally {
    await ctx.close();
    srv.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

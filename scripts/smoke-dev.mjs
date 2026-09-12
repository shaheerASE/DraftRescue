/**
 * Smoke test for the DEV build's diagnostics.
 *
 *   npx wxt build -m development && npm run smoke:dev
 *
 * WHY SEPARATE FROM scripts/smoke.mjs
 * That one tests the production build, where every diagnostic is compiled out.
 * But the diagnostics are now the thing you reach for when a site is not being
 * captured, so they need to be right — and "right" cuts both ways:
 *
 *   - a real problem must be reported (a closed shadow root, a refused field)
 *   - a non-problem must stay quiet
 *
 * The second half is not fussiness. Reddit's web components re-dispatch the
 * input event as themselves after the real one fires, so a naive diagnostic
 * shouts "UNRESOLVED" about a duplicate of an event that was captured fine.
 * A false alarm in a debugging tool is worse than no tool: it sends you looking
 * for a bug that is not there.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const EXT = resolve(ROOT, '.output/chrome-mv3-dev');
const FIXTURES = resolve(ROOT, 'test');
const SETTLE_MS = 2500;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm install');
  process.exit(1);
}

const TYPES = { '.html': 'text/html; charset=utf-8' };
const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  const file = join(FIXTURES, path === '/' ? 'fixtures.html' : path);
  if (!file.startsWith(FIXTURES)) {
    res.writeHead(403).end();
    return;
  }
  let body;
  try {
    body = await readFile(file);
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'text/plain' }).end(body);
});

await new Promise((done) => server.listen(0, '127.0.0.1', done));
const base = `http://127.0.0.1:${server.address().port}`;
const userDataDir = mkdtempSync(join(tmpdir(), 'draft-rescue-dev-'));

let failures = 0;
function check(label, condition, detail) {
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

let ctx;
try {
  ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: 'chromium',
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
} catch (error) {
  console.error('Could not launch Chromium. If the browser is missing:');
  console.error('  npx playwright install chromium');
  console.error(String(error));
  process.exit(1);
}

console.log('\nDraft Rescue dev-diagnostics smoke test\n');

let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
if (!sw) {
  console.log('  FAIL  service worker never registered');
  await ctx.close();
  server.close();
  process.exit(1);
}

const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => {
  if (m.text().includes('Draft Rescue')) logs.push(m.text());
});
await page.goto(`${base}/fixtures.html`, { waitUntil: 'load' });

// A field that must be refused, with a reason the log should name.
await page.locator('#cc').pressSequentially('4242424242424242', { delay: 1 });

// A field inside a closed shadow root: genuinely unreachable, must be reported.
await page.evaluate(() => {
  const field = window.__closedRoot.getElementById('ci');
  field.focus();
  field.value = 'typed into a closed root here';
  field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
});

// An ordinary field, which must just work.
await page
  .locator('#ta')
  .pressSequentially('A cover letter that is definitely long enough.', { delay: 1 });

// The Reddit-shaped composer, whose host re-dispatches the input event as
// itself. Must capture, and must NOT produce a diagnostic about the duplicate.
await page.locator('#reddit-like [contenteditable]').click();
await page.keyboard.type('A comment in the Reddit-shaped composer here.');

await page.waitForTimeout(SETTLE_MS);

const rows = await sw.evaluate(async () => {
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('draft-rescue');
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  const all = await new Promise((res, rej) => {
    const req = db.transaction('snapshots').objectStore('snapshots').getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  db.close();
  return all;
});

console.log('  console output a developer would see:');
for (const line of logs) console.log(`    ${line}`);
console.log('');

check(
  'a refused field names the rule that refused it',
  logs.some((l) => l.includes('REFUSED') && l.includes('cc-number')),
);
check(
  'a closed shadow root is reported, and identified as such',
  logs.some((l) => l.includes('UNRESOLVED') && l.includes('closed-host') && l.includes('likelyClosedShadowRoot: true')),
);
check(
  'the Reddit-shaped composer is captured',
  rows.some((r) => r.text.includes('Reddit-shaped composer')),
  rows.map((r) => r.text.slice(0, 50)).join(' | '),
);
check(
  'no false alarm for the component re-dispatching its own input event',
  !logs.some((l) => l.includes('UNRESOLVED') && l.includes('reddit-like')),
  logs.filter((l) => l.includes('UNRESOLVED')).join('\n        '),
);
check('an ordinary field is captured', rows.some((r) => r.text.includes('cover letter')));

await ctx.close();
server.close();
rmSync(userDataDir, { recursive: true, force: true });

console.log(`\n${failures === 0 ? 'All dev-diagnostic checks passed.' : `${failures} check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);

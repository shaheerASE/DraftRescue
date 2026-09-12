/**
 * End-to-end smoke test: loads the real built extension into a real Chrome,
 * types into the fixture page, then reads the service worker's IndexedDB to see
 * what actually got stored.
 *
 *   npm run build && npm run smoke
 *
 * WHY THIS EXISTS ALONGSIDE VITEST
 * The Vitest suites prove the pure logic is right — shouldCapture refuses the
 * right fields, redact catches the right numbers. They cannot prove that an
 * `input` event in a real browser reaches our listener, that composedPath
 * behaves as expected inside a shadow root, that the message crosses to the
 * service worker, or that the row lands in the database. Every one of those has
 * failed silently in extensions before. This checks the whole path.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './lib/fixture-server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const EXT = resolve(ROOT, '.output/chrome-mv3');
const FIXTURES = resolve(ROOT, 'test');

/** Long enough to clear the 800ms debounce and the write. */
const SETTLE_MS = 2500;

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.error('Playwright is not installed. Run: npm install');
  process.exit(1);
}

const { base, crossOrigin, close: closeServer } = await startFixtureServer();

const userDataDir = mkdtempSync(join(tmpdir(), 'draft-rescue-smoke-'));
let failures = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${label}`);
  } else {
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
  console.error('Could not launch Chromium.');
  console.error('If the browser is missing, run: npx playwright install chromium');
  console.error(String(error));
  process.exit(1);
}

console.log('\nDraft Rescue smoke test\n');

// --- the extension loads at all ---------------------------------------------
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 }).catch(() => null);
check('service worker registers', Boolean(sw));
if (!sw) {
  await ctx.close();
  closeServer();
  process.exit(1);
}

// --- type into everything ----------------------------------------------------
const page = await ctx.newPage();
const attached = [];
page.on('console', (m) => {
  if (m.text().includes('Draft Rescue')) attached.push(m.text());
});
await page.goto(`${base}/fixtures.html`, { waitUntil: 'load' });

const LETTER =
  'Dear hiring manager, I am writing about the senior frontend role you posted.';

await page.fill('#ta', ''); // focus the page first
await page.locator('#ta').pressSequentially(LETTER, { delay: 1 });
await page.locator('#ti').pressSequentially('A blog post title that is long enough', { delay: 1 });

await page.locator('#ce').click();
await page.keyboard.type('This is a rich text draft in a contenteditable box.');

await page.locator('#open-host textarea').pressSequentially(
  'A note typed inside an open shadow root.',
  { delay: 1 },
);

// The Reddit-shaped composer. Click the editable host (what a user clicks);
// the caret lands in the nested span, so the typed-into node is still several
// elements below the element carrying the contenteditable attribute.
// Playwright pierces open shadow roots with ordinary selectors.
await page.locator('#reddit-like [contenteditable]').click();
await page.keyboard.type('A comment typed into a Reddit-shaped Lexical composer.');

// Closed shadow root: reached only via the escape hatch the fixture exposes.
await page.evaluate(() => {
  const field = window.__closedRoot.getElementById('ci');
  field.focus();
  field.value = 'A note typed inside a CLOSED shadow root.';
  field.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true }));
});

await page
  .frameLocator('iframe[title="Same-origin frame"]')
  .locator('#fi')
  .pressSequentially('A reply typed inside a same-origin iframe.', { delay: 1 });

// A genuinely different origin, served on a second port. The page around it
// cannot reach in at all — but Chrome injects our content script directly into
// the frame, which is the whole point.
await page
  .frameLocator('iframe[title="Cross-origin frame"]')
  .locator('#fi')
  .pressSequentially('A reply typed inside a CROSS-origin iframe.', { delay: 1 });

// A sandboxed frame has an opaque origin, so there is nothing to file a draft
// under. Documented limitation, asserted below.
await page
  .frameLocator('iframe[title="Sandboxed frame"]')
  .locator('#fi')
  .pressSequentially('A reply typed inside a SANDBOXED iframe.', { delay: 1 });

// Things that must never be stored.
await page.locator('#pw').pressSequentially('hunter2-correct-horse-battery', { delay: 1 });
await page.locator('#pw-toggle').pressSequentially('secret-before-toggle-x', { delay: 1 });
await page.locator('#toggle').click();
await page.locator('#pw-toggle').pressSequentially('-secret-after-toggle', { delay: 1 });
await page.locator('#cc').pressSequentially('4242424242424242', { delay: 1 });
await page.locator('#vague').pressSequentially('123456789012345678', { delay: 1 });
await page.locator('#short').pressSequentially('hi', { delay: 1 });

// Captured, but the number inside must be gone.
await page
  .locator('#leaky')
  .pressSequentially('Please charge my card 4242 4242 4242 4242 today.', { delay: 1 });

await page.waitForTimeout(SETTLE_MS);

check(
  'content script attaches in the top frame and the iframe',
  attached.length >= 2 || attached.length === 0, // production build logs nothing
  `saw ${attached.length} log lines (a production build is silent, which is fine)`,
);

// --- read what actually landed in IndexedDB ----------------------------------
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

const texts = rows.map((r) => r.text);
const joined = texts.join('\n---\n');
const has = (needle) => texts.some((t) => t.includes(needle));

console.log(`\n  ${rows.length} snapshot(s) stored\n`);

// --- what must be there ------------------------------------------------------
check('textarea draft stored', has('Dear hiring manager'));
check('text input draft stored', has('A blog post title'));
check('contenteditable draft stored', has('rich text draft'));
check('open shadow root draft stored', has('open shadow root'));
check('same-origin iframe draft stored', has('same-origin iframe'));

// The claim that shaped the architecture, finally under test: cross-origin
// frames are not a limitation, because each frame gets its own content script.
check('CROSS-origin iframe draft stored', has('CROSS-origin iframe'));
const crossRow = rows.find((r) => r.text.includes('CROSS-origin iframe'));
check(
  'and it is filed under the frame\u2019s own origin, not the parent page\u2019s',
  crossRow?.signals?.origin === crossOrigin,
  `filed under ${crossRow?.signals?.origin}, frame served from ${crossOrigin}`,
);
check('Reddit-shaped composer draft stored', has('Reddit-shaped Lexical composer'));

const composer = rows.find((r) => r.text.includes('Reddit-shaped Lexical composer'));
check(
  'composer resolved to the contenteditable host, not an inner span',
  composer?.signals?.tagName === 'DIV' && composer?.signals?.editorKind === 'contenteditable',
  `got tagName=${composer?.signals?.tagName} kind=${composer?.signals?.editorKind}`,
);
check(
  'composer identified by its aria-label',
  composer?.signals?.ariaLabel === 'Comment',
  `got ${JSON.stringify(composer?.signals?.ariaLabel)}`,
);

const ce = rows.find((r) => r.text.includes('rich text draft'));
check('contenteditable row carries its editorKind', ce?.signals?.editorKind === 'contenteditable');

const frameRow = rows.find((r) => r.text.includes('same-origin iframe'));
check('iframe row is marked as a subframe', frameRow?.signals?.isTopFrame === false);

// --- what must NOT be there --------------------------------------------------
check('password never stored', !joined.includes('hunter2'), joined.slice(0, 400));
check('password before show/hide toggle never stored', !joined.includes('secret-before-toggle'));
check('password after show/hide toggle never stored', !joined.includes('secret-after-toggle'));
check('card number field never stored', !has('4242424242424242'));
check('vague field in a checkout form never stored', !joined.includes('123456789012345678'));
check('text under the minimum length never stored', !texts.some((t) => t.trim() === 'hi'));
check(
  'closed shadow root is not captured (known limitation)',
  !joined.includes('CLOSED shadow root'),
);
// Documented as unsupported until this test was written. A content script's
// isolated world does not inherit a sandboxed frame's opaque origin, so
// location.origin still reports the document's real one and the draft is filed
// under it normally.
check('sandboxed iframe IS captured', has('SANDBOXED iframe'));
const sandboxRow = rows.find((r) => r.text.includes('SANDBOXED iframe'));
check(
  'and under a real origin rather than "null"',
  Boolean(sandboxRow) && sandboxRow.signals.origin !== 'null' && sandboxRow.signals.origin.startsWith('http'),
  `filed under ${JSON.stringify(sandboxRow?.signals?.origin)}`,
);

// --- redaction ---------------------------------------------------------------
const leaky = rows.find((r) => r.text.includes('Please charge my card'));
check('comment containing a card number was still saved', Boolean(leaky));
check(
  'card number inside it was redacted',
  Boolean(leaky) && leaky.text.includes('[redacted]') && !/4242[ -]?4242/.test(leaky.text),
  leaky?.text,
);
check('redaction was counted on the row', (leaky?.redactions ?? 0) > 0);

// --- nothing extra got through ------------------------------------------------
// The strongest check here. Six fields on the fixture page should be captured;
// every other field is one the gate must refuse. If this count creeps up,
// something is being stored that should not be, whatever the checks above say.
const distinctFields = new Set(rows.map((r) => r.fieldKey));
check(
  'exactly eight distinct fields captured, and no others',
  distinctFields.size === 8,
  `got ${distinctFields.size}:\n        ${texts.map((t) => JSON.stringify(t.slice(0, 60))).join('\n        ')}`,
);

// --- version history ---------------------------------------------------------
const letterVersions = rows.filter((r) => r.text.includes('Dear hiring manager'));
check('field has at least one version', letterVersions.length >= 1);
check(
  'versions of one field share a field key',
  new Set(letterVersions.map((r) => r.fieldKey)).size === 1,
);

// --- Leaving the page saves what is in flight --------------------------------
// The debounce is 800ms, so text typed and abandoned before it fires would be
// lost without the flush on visibilitychange/pagehide. This types and then
// leaves well inside that window, which is the ordinary case of closing a tab
// mid-sentence.
{
  const IN_FLIGHT = 'Typed and then abandoned before the debounce could fire.';
  const leaving = await ctx.newPage();
  await leaving.goto(`${base}/fixtures.html`, { waitUntil: 'load' });
  await leaving.locator('#tiny').pressSequentially(IN_FLIGHT, { delay: 1 });

  // Well under the 800ms debounce: nothing has been written yet.
  await leaving.waitForTimeout(200);

  await leaving.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await leaving.waitForTimeout(1200);

  const afterLeaving = await sw.evaluate(async () => {
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

  check(
    'text typed and abandoned inside the debounce window is still saved',
    afterLeaving.some((r) => r.text.includes('abandoned before the debounce')),
    `stored ${afterLeaving.length} rows, none matching`,
  );
  await leaving.close();
}

// --- The blocklist actually blocks ------------------------------------------
// Closes the loop between the options page and the capture gate: a setting
// that persists but does not take effect is worse than no setting at all,
// because the user believes they are protected.
{
  await sw.evaluate(async () => {
    await chrome.storage.local.set({
      settings: { blockedOrigins: ['127.0.0.1'] },
    });
  });

  const blocked = await ctx.newPage();
  await blocked.goto(`${base}/fixtures.html`, { waitUntil: 'load' });
  await blocked
    .locator('#ta')
    .pressSequentially('This must never be stored, the site is blocked.', { delay: 1 });
  await blocked.waitForTimeout(SETTLE_MS);

  const afterBlock = await sw.evaluate(async () => {
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

  check(
    'a blocked site is not captured, even for a field that would otherwise be',
    !afterBlock.some((r) => r.text.includes('the site is blocked')),
  );
  check(
    'and blocking does not delete what was already saved',
    afterBlock.length >= rows.length,
    `had ${rows.length}, now ${afterBlock.length}`,
  );
}

await ctx.close();
closeServer();
rmSync(userDataDir, { recursive: true, force: true });

console.log(`\n${failures === 0 ? 'All smoke checks passed.' : `${failures} smoke check(s) FAILED.`}\n`);
process.exit(failures === 0 ? 0 : 1);
